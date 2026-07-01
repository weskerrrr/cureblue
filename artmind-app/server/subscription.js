/**
 * 心绘 ArtMind — Freemium 订阅 + 支付模块（参考实现 / Node.js）
 *
 * 关键流程：
 *   1) 选择套餐 → 2) 未成年人需家长确认（双方知情）→ 3) 创建支付单（幂等）
 *   → 4) 跳转支付（微信/支付宝/Apple/Google）→ 5) 异步回调验签
 *   → 6) 激活订阅并刷新 entitlements（功能墙权威）→ 7) 到期/续费/退款
 *
 * 权益模型：所有"功能墙"以 entitlements 表为准，前端只是体验拦截。
 */

// ---- 套餐定义（与 PRD §3 一致）----
const PLANS = {
  free:    { priceCents: 0,     period: null,    entitlements: ENT_FREE() },
  monthly: { priceCents: 3900,  period: "month", entitlements: ENT_PRO() },
  yearly:  { priceCents: 29900, period: "year",  entitlements: ENT_PRO() },
};

function ENT_FREE() {
  return { ai_unlimited: false, ai_daily_quota: 3, therapy_full: false, meditation_full: false,
           booking_1v1: false, storage_quota_mb: 200, family_space: false };
}
function ENT_PRO() {
  return { ai_unlimited: true, ai_daily_quota: 999999, therapy_full: true, meditation_full: true,
           booking_1v1: true, storage_quota_mb: 50 * 1024, family_space: true };
}

// ============================================================
// 1) 发起订阅
// ============================================================
async function startSubscription(ctx, { userId, planId, provider }) {
  const plan = PLANS[planId];
  if (!plan || planId === "free") throw httpErr(400, "INVALID_PLAN");

  const user = await ctx.db.getUser(userId);

  // 未成年人：必须先取得家长授权（pending_guardian）
  if (user.is_minor) {
    const guardian = await ctx.db.getGuardianFor(userId);
    if (!guardian || !guardian.can_approve_pay) throw httpErr(403, "GUARDIAN_REQUIRED");

    const sub = await ctx.db.createSubscription({
      user_id: userId, plan: planId, status: "pending_guardian", provider,
    });
    // 向家长推送付费确认请求
    await ctx.notify.toUser(guardian.parent_id, {
      type: "approve_payment",
      message: `您的孩子申请订阅「${planId === "yearly" ? "年度" : "月度"}会员」，请确认。`,
      subscriptionId: sub.id,
    });
    return { status: "pending_guardian", subscriptionId: sub.id };
  }

  // 成年用户（疗愈师/家长本人）：直接进入支付
  return createPaymentOrder(ctx, { userId, planId, provider });
}

// ============================================================
// 2) 家长确认 → 进入支付
// ============================================================
async function guardianApprove(ctx, { guardianId, subscriptionId }) {
  const sub = await ctx.db.getSubscription(subscriptionId);
  const rel = await ctx.db.getGuardianship(guardianId, sub.user_id);
  if (!rel || !rel.can_approve_pay) throw httpErr(403, "NOT_AUTHORIZED");

  await ctx.db.updateSubscription(subscriptionId, { guardian_approver: guardianId });
  await ctx.audit.log(guardianId, "approve_child_payment", subscriptionId);

  return createPaymentOrder(ctx, { userId: sub.user_id, planId: sub.plan, provider: sub.provider });
}

// ============================================================
// 3) 创建支付单（幂等，防重复扣款）
// ============================================================
async function createPaymentOrder(ctx, { userId, planId, provider }) {
  const plan = PLANS[planId];
  const idempotencyKey = `${userId}:${planId}:${ctx.dayBucket()}`; // 同日同套餐幂等

  const existing = await ctx.db.findPaymentByIdempotency(idempotencyKey);
  if (existing && existing.status === "pending") {
    return { payUrl: existing.pay_url, paymentId: existing.id };
  }

  const payment = await ctx.db.createPayment({
    user_id: userId, amount_cents: plan.priceCents, currency: "CNY",
    provider, idempotency_key: idempotencyKey, status: "pending",
  });

  // 调用支付供应商下单（伪实现）
  const order = await ctx.payments[provider].createOrder({
    outTradeNo: payment.id,
    amountCents: plan.priceCents,
    subject: `心绘 ArtMind ${planId === "yearly" ? "年度" : "月度"}会员`,
  });

  await ctx.db.updatePayment(payment.id, { pay_url: order.payUrl });
  return { payUrl: order.payUrl, paymentId: payment.id };
}

// ============================================================
// 4) 支付回调（验签 + 激活，必须幂等）
// ============================================================
async function handlePaymentWebhook(ctx, { provider, rawBody, signature }) {
  const ok = ctx.payments[provider].verifySignature(rawBody, signature);
  if (!ok) throw httpErr(400, "BAD_SIGNATURE");

  const evt = ctx.payments[provider].parse(rawBody);
  if (evt.status !== "succeeded") return { ok: true }; // 仅处理成功

  const payment = await ctx.db.getPayment(evt.outTradeNo);
  if (!payment) throw httpErr(404, "PAYMENT_NOT_FOUND");
  if (payment.status === "succeeded") return { ok: true }; // 幂等：已处理

  await ctx.db.transaction(async (tx) => {
    await tx.updatePayment(payment.id, { status: "succeeded", provider_txn_id: evt.txnId });
    const sub = await tx.getSubscriptionByUser(payment.user_id);
    await activateSubscription(tx, sub.id, sub.plan);
  });

  await ctx.audit.log(payment.user_id, "subscription_activated", payment.id);
  return { ok: true };
}

// ============================================================
// 5) 激活订阅 + 刷新权益（功能墙权威来源）
// ============================================================
async function activateSubscription(db, subscriptionId, planId) {
  const periodEnd = planId === "yearly" ? addMonths(12) : addMonths(1);
  await db.updateSubscription(subscriptionId, {
    plan: planId, status: "active", current_period_end: periodEnd,
  });
  const sub = await db.getSubscription(subscriptionId);
  await db.upsertEntitlements(sub.user_id, PLANS[planId].entitlements);
}

// ============================================================
// 6) 取消 / 到期降级 / 退款
// ============================================================
async function cancelSubscription(ctx, { userId }) {
  const sub = await ctx.db.getSubscriptionByUser(userId);
  await ctx.db.updateSubscription(sub.id, { status: "canceled" });
  // 到期前仍享权益；到期由定时任务降级
  return { status: "canceled", accessUntil: sub.current_period_end };
}

// 定时任务：每日扫描到期订阅 → 降级为 free
async function expireDueSubscriptions(ctx) {
  const due = await ctx.db.findExpiredSubscriptions(new Date());
  for (const sub of due) {
    await ctx.db.updateSubscription(sub.id, { status: "expired", plan: "free" });
    await ctx.db.upsertEntitlements(sub.user_id, ENT_FREE());
    await ctx.notify.toUser(sub.user_id, { type: "downgraded", message: "会员已到期，已切换为免费版。" });
  }
}

// ---- 工具 ----
function addMonths(n) { const d = new Date(); d.setMonth(d.getMonth() + n); return d; }
function httpErr(code, msg) { const e = new Error(msg); e.code = code; return e; }

module.exports = {
  PLANS, startSubscription, guardianApprove, createPaymentOrder,
  handlePaymentWebhook, activateSubscription, cancelSubscription, expireDueSubscriptions,
};

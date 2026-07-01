// POST /api/subscribe — Freemium 订阅（未成年人需家长确认 → 激活权益）
// body: { planId: "monthly"|"yearly", guardianApproved?: bool }
// 说明：真实支付走供应商下单 + 回调验签（见 server/subscription.js）；
//      此处在 D1 中激活订阅并刷新 entitlements（功能墙权威）。
import { json, error, preflight, getUser } from "../_lib/response.js";
import { PLANS, isMinorRole, addMonthsISO } from "../_lib/entitlements.js";
import { ensureUser, upsertEntitlements, upsertSubscription } from "../_lib/db.js";

export async function onRequestOptions() {
  return preflight();
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return error("D1 未绑定（env.DB）", 503);
  const { id, role } = getUser(request);
  const { planId, guardianApproved = false } = await request.json().catch(() => ({}));

  const plan = PLANS[planId];
  if (!plan || planId === "free") return error("无效的套餐");

  await ensureUser(env.DB, id, role);

  // 未成年人：先需家长确认
  if (isMinorRole(role) && !guardianApproved) {
    await upsertSubscription(env.DB, id, planId, "pending_guardian", null);
    return json({ ok: true, status: "pending_guardian", message: "已向绑定的家长账号发起付费确认。" });
  }

  // 激活订阅 + 刷新权益
  const periodEnd = addMonthsISO(plan.periodMonths);
  await upsertSubscription(env.DB, id, planId, "active", periodEnd);
  await upsertEntitlements(env.DB, id, plan.ent);

  return json({ ok: true, status: "active", plan: planId, currentPeriodEnd: periodEnd, entitlements: plan.ent });
}

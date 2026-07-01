// GET /api/me — 返回当前用户的权益与今日 AI 剩余额度（功能墙权威来源）
import { json, error, preflight, getUser } from "../_lib/response.js";
import { ensureUser, getEntitlements, getDailyUsage } from "../_lib/db.js";

export async function onRequestOptions() {
  return preflight();
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return error("D1 未绑定（env.DB）", 503);
  const { id, role } = getUser(request);
  await ensureUser(env.DB, id, role);

  const ent = await getEntitlements(env.DB, id);
  const used = await getDailyUsage(env.DB, id);
  const isPro = ent.ai_unlimited === 1;
  const quotaLeft = isPro ? Infinity : Math.max(0, ent.ai_daily_quota - used);

  return json({
    ok: true,
    userId: id,
    isPro,
    plan: isPro ? "pro" : "free",
    entitlements: ent,
    aiQuotaLeft: isPro ? -1 : quotaLeft, // -1 表示无限
  });
}

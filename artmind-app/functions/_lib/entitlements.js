// Freemium 套餐与权益定义（与 PRD §3 / server/subscription.js 保持一致）

export const PLANS = {
  free:    { priceCents: 0,     periodMonths: 0,  ent: entFree() },
  monthly: { priceCents: 3900,  periodMonths: 1,  ent: entPro() },
  yearly:  { priceCents: 29900, periodMonths: 12, ent: entPro() },
};

export function entFree() {
  return {
    ai_unlimited: 0, ai_daily_quota: 3, therapy_full: 0, meditation_full: 0,
    booking_1v1: 0, storage_quota_mb: 200, family_space: 0,
  };
}

export function entPro() {
  return {
    ai_unlimited: 1, ai_daily_quota: 999999, therapy_full: 1, meditation_full: 1,
    booking_1v1: 1, storage_quota_mb: 50 * 1024, family_space: 1,
  };
}

// 未成年角色（订阅需家长确认）
export function isMinorRole(role) {
  return role === "blind_teen" || role === "deaf_teen";
}

export function addMonthsISO(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString();
}

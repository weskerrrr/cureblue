// D1 数据访问层：封装心绘 ArtMind 后端所需的所有查询。
// env.DB 为 wrangler.toml 中绑定的 D1 数据库。

import { entFree } from "./entitlements.js";
import { today, uuid } from "./response.js";

// 确保用户存在（原型无鉴权：首次访问自动建档 + 免费权益）
export async function ensureUser(db, userId, role = "blind_teen") {
  const roleOk = ["blind_teen", "deaf_teen", "therapist", "parent"].includes(role) ? role : "blind_teen";
  const isMinor = roleOk === "blind_teen" || roleOk === "deaf_teen" ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO users (id, role, display_name, is_minor)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET role = ?2, is_minor = ?4`
    )
    .bind(userId, roleOk, "访客用户", isMinor)
    .run();

  const ent = await getEntitlements(db, userId);
  if (!ent) {
    const f = entFree();
    await db
      .prepare(
        `INSERT INTO entitlements (user_id, ai_unlimited, ai_daily_quota, therapy_full, meditation_full, booking_1v1, storage_quota_mb, family_space)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
      )
      .bind(userId, f.ai_unlimited, f.ai_daily_quota, f.therapy_full, f.meditation_full, f.booking_1v1, f.storage_quota_mb, f.family_space)
      .run();
  }
}

export async function getEntitlements(db, userId) {
  return await db.prepare(`SELECT * FROM entitlements WHERE user_id = ?1`).bind(userId).first();
}

export async function upsertEntitlements(db, userId, e) {
  await db
    .prepare(
      `INSERT INTO entitlements (user_id, ai_unlimited, ai_daily_quota, therapy_full, meditation_full, booking_1v1, storage_quota_mb, family_space, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         ai_unlimited=?2, ai_daily_quota=?3, therapy_full=?4, meditation_full=?5,
         booking_1v1=?6, storage_quota_mb=?7, family_space=?8, updated_at=datetime('now')`
    )
    .bind(userId, e.ai_unlimited, e.ai_daily_quota, e.therapy_full, e.meditation_full, e.booking_1v1, e.storage_quota_mb, e.family_space)
    .run();
}

// AI 每日用量
export async function getDailyUsage(db, userId) {
  const row = await db.prepare(`SELECT count FROM ai_usage_daily WHERE user_id = ?1 AND usage_date = ?2`).bind(userId, today()).first();
  return row ? row.count : 0;
}

export async function incrDailyUsage(db, userId) {
  await db
    .prepare(
      `INSERT INTO ai_usage_daily (user_id, usage_date, count) VALUES (?1, ?2, 1)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET count = count + 1`
    )
    .bind(userId, today())
    .run();
}

export async function logAiInvocation(db, userId, capability, success, latency) {
  await db
    .prepare(`INSERT INTO ai_invocations (id, user_id, capability, success, latency_ms) VALUES (?1,?2,?3,?4,?5)`)
    .bind(uuid(), userId, capability, success ? 1 : 0, latency)
    .run();
}

// 社区
export async function listPosts(db, includeHidden = false) {
  const sql = includeHidden
    ? `SELECT * FROM posts ORDER BY created_at DESC LIMIT 50`
    : `SELECT * FROM posts WHERE visible = 1 ORDER BY created_at DESC LIMIT 50`;
  const { results } = await db.prepare(sql).all();
  return results || [];
}

export async function insertPost(db, { authorName, body, action, visible }) {
  const id = uuid();
  await db
    .prepare(`INSERT INTO posts (id, author_name, body, mod_action, visible) VALUES (?1,?2,?3,?4,?5)`)
    .bind(id, authorName, body, action, visible ? 1 : 0)
    .run();
  return id;
}

export async function insertModerationLog(db, { contentId, authorId, action, score, categories, reason }) {
  await db
    .prepare(
      `INSERT INTO moderation_logs (id, content_type, content_id, author_id, action, risk_score, categories, reason)
       VALUES (?1,'post',?2,?3,?4,?5,?6,?7)`
    )
    .bind(uuid(), contentId, authorId, action, score, JSON.stringify(categories || {}), reason || "")
    .run();
}

export async function insertCrisisEvent(db, userId, contentId) {
  await db
    .prepare(
      `INSERT INTO crisis_events (id, user_id, trigger_content, notified_therapist, notified_guardian, hotline_pushed)
       VALUES (?1,?2,?3,1,1,1)`
    )
    .bind(uuid(), userId, contentId || null)
    .run();
}

// 订阅
export async function upsertSubscription(db, userId, plan, status, periodEnd) {
  const existing = await db.prepare(`SELECT id FROM subscriptions WHERE user_id = ?1`).bind(userId).first();
  if (existing) {
    await db
      .prepare(`UPDATE subscriptions SET plan=?2, status=?3, current_period_end=?4 WHERE user_id=?1`)
      .bind(userId, plan, status, periodEnd)
      .run();
    return existing.id;
  }
  const id = uuid();
  await db
    .prepare(`INSERT INTO subscriptions (id, user_id, plan, status, current_period_end) VALUES (?1,?2,?3,?4,?5)`)
    .bind(id, userId, plan, status, periodEnd)
    .run();
  return id;
}

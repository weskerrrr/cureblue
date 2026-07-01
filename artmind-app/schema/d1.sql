-- ============================================================
-- 心绘 ArtMind — Cloudflare D1 (SQLite) 表结构
-- 由 server/schema.sql (PostgreSQL) 迁移而来，适配 D1：
--   * 无 ENUM     → 用 TEXT + CHECK 约束
--   * 无 uuid 扩展 → 主键由应用层（crypto.randomUUID）生成
--   * TIMESTAMPTZ → TEXT（ISO 8601 字符串）
--   * BYTEA/JSONB → TEXT（密文 base64 / JSON 字符串）
--   * 布尔       → INTEGER(0/1)
-- 安全语义保持不变：[ENC] 字段级加密、[DESENS] 情绪脱敏（应用层落地）
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------------- 用户与监护 ----------------
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  role              TEXT NOT NULL CHECK (role IN ('blind_teen','deaf_teen','therapist','parent')),
  display_name      TEXT NOT NULL,
  real_name_enc     TEXT,           -- [ENC]
  phone_enc         TEXT,           -- [ENC]
  birth_date        TEXT,
  is_minor          INTEGER NOT NULL DEFAULT 1,  -- 0/1，应用层按 birth_date 计算
  cert_no_enc       TEXT,           -- [ENC] 疗愈师证书
  cert_verified     INTEGER NOT NULL DEFAULT 0,
  consent_self      INTEGER NOT NULL DEFAULT 0,
  consent_guardian  INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT
);

CREATE TABLE IF NOT EXISTS guardianships (
  id               TEXT PRIMARY KEY,
  parent_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teen_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  relation         TEXT,
  verified_at      TEXT,
  can_view_dm      INTEGER NOT NULL DEFAULT 1,
  can_approve_pay  INTEGER NOT NULL DEFAULT 1,
  UNIQUE (parent_id, teen_id)
);

CREATE TABLE IF NOT EXISTS accessibility_prefs (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  screen_reader  INTEGER DEFAULT 0,
  high_contrast  INTEGER DEFAULT 0,
  font_scale     REAL DEFAULT 1.0,
  captions_on    INTEGER DEFAULT 1,
  haptics_on     INTEGER DEFAULT 1,
  voice_control  INTEGER DEFAULT 0,
  tts_rate       REAL DEFAULT 1.0
);

-- ---------------- 订阅与支付 ----------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan               TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','monthly','yearly')),
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','canceled','expired','past_due','pending_guardian')),
  guardian_approver  TEXT REFERENCES users(id),
  current_period_end TEXT,
  provider           TEXT,
  provider_sub_id    TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 权益快照：所有功能墙以此为权威校验
CREATE TABLE IF NOT EXISTS entitlements (
  user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ai_unlimited     INTEGER NOT NULL DEFAULT 0,
  ai_daily_quota   INTEGER NOT NULL DEFAULT 3,
  therapy_full     INTEGER NOT NULL DEFAULT 0,
  meditation_full  INTEGER NOT NULL DEFAULT 0,
  booking_1v1      INTEGER NOT NULL DEFAULT 0,
  storage_quota_mb INTEGER NOT NULL DEFAULT 200,
  family_space     INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  subscription_id TEXT REFERENCES subscriptions(id),
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'CNY',
  provider        TEXT NOT NULL,
  provider_txn_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI 每日用量（免费额度限流，按 user_id + 日期）
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date  TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

-- ---------------- 创作工坊 ----------------
CREATE TABLE IF NOT EXISTS artworks (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT,
  kind            TEXT NOT NULL,
  asset_url       TEXT,
  audio_thumb_url TEXT,
  caption_url     TEXT,
  prompt          TEXT,
  ai_alt_text     TEXT,
  is_private      INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_invocations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  capability  TEXT NOT NULL,
  provider    TEXT,
  latency_ms  INTEGER,
  success     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- 疗愈任务 ----------------
CREATE TABLE IF NOT EXISTS therapy_tasks (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  level         TEXT NOT NULL,
  est_minutes   INTEGER,
  source        TEXT NOT NULL DEFAULT 'ai',
  assigned_by   TEXT REFERENCES users(id),
  assigned_date TEXT NOT NULL DEFAULT (date('now')),
  completed_at  TEXT
);

-- 情绪反馈（[DESENS] 仅存离散等级+不可逆哈希）
CREATE TABLE IF NOT EXISTS mood_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mood_level      INTEGER NOT NULL CHECK (mood_level BETWEEN 1 AND 5),
  mood_tag        TEXT,
  source_ref_hash TEXT,
  logged_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS progress_reports (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  streak_days     INTEGER,
  completion_rate REAL,
  mood_trend      TEXT,            -- JSON 数组字符串（已脱敏）
  summary         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id           TEXT PRIMARY KEY,
  teen_id      TEXT NOT NULL REFERENCES users(id),
  therapist_id TEXT NOT NULL REFERENCES users(id),
  start_at     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'requested',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- 安全社区 + 审核 ----------------
CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  author_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  body        TEXT,
  artwork_id  TEXT REFERENCES artworks(id),
  has_image   INTEGER NOT NULL DEFAULT 0,
  mod_action  TEXT NOT NULL DEFAULT 'review'
                CHECK (mod_action IN ('approve','mask','block','review','crisis')),
  visible     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id               TEXT PRIMARY KEY,
  from_id          TEXT NOT NULL REFERENCES users(id),
  to_id            TEXT NOT NULL REFERENCES users(id),
  body             TEXT,
  mod_action       TEXT NOT NULL DEFAULT 'review',
  guardian_visible INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id           TEXT PRIMARY KEY,
  content_type TEXT NOT NULL CHECK (content_type IN ('post','comment','dm','artwork')),
  content_id   TEXT NOT NULL,
  author_id    TEXT REFERENCES users(id),
  action       TEXT NOT NULL CHECK (action IN ('approve','mask','block','review','crisis')),
  risk_score   REAL,
  categories   TEXT,             -- JSON 字符串
  reason       TEXT,
  reviewed_by  TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS crisis_events (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  trigger_content    TEXT,
  notified_therapist INTEGER DEFAULT 0,
  notified_guardian  INTEGER DEFAULT 0,
  hotline_pushed     INTEGER DEFAULT 0,
  handled_by         TEXT REFERENCES users(id),
  handled_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   TEXT REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT,
  ip_hash    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------- 索引 ----------------
CREATE INDEX IF NOT EXISTS idx_artworks_user   ON artworks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON therapy_tasks(user_id, assigned_date);
CREATE INDEX IF NOT EXISTS idx_mood_user_time  ON mood_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_posts_visible   ON posts(visible, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_content     ON moderation_logs(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_dm_to           ON direct_messages(to_id, created_at DESC);

-- ============================================================
-- 种子数据（演示用）：几条社区动态，覆盖通过/拦截/危机三种审核结果
-- ============================================================
INSERT OR IGNORE INTO posts (id, author_name, body, has_image, mod_action, visible, created_at) VALUES
  ('seed-p1', '小帆（视障）', '今天用语音画了一片海，AI 帮我配了海浪声，太治愈了！', 0, 'approve', 1, datetime('now','-2 hours')),
  ('seed-p2', '阿乐（听障）', '把我最喜欢的歌做成了流动的色块，分享给大家～', 1, 'approve', 1, datetime('now','-1 hours')),
  ('seed-p3', '匿名', '［内容已被安全系统拦截］', 0, 'block', 0, datetime('now','-30 minutes'));

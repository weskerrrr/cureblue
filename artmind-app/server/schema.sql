-- ============================================================
-- 心绘 ArtMind — 数据库表结构（PostgreSQL）
-- 安全要点：
--   * 未成年人 PII 字段级加密（注释标注 [ENC]，应用层 AES-256-GCM 加密后入库）
--   * 情绪原始数据脱敏，仅存离散标签 + 不可逆引用（注释标注 [DESENS]）
--   * 监护双同意、可删除（被遗忘权）、全审计留痕
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- 枚举类型 ----------
CREATE TYPE user_role      AS ENUM ('blind_teen', 'deaf_teen', 'therapist', 'parent');
CREATE TYPE plan_type      AS ENUM ('free', 'monthly', 'yearly');
CREATE TYPE sub_status     AS ENUM ('active', 'canceled', 'expired', 'past_due', 'pending_guardian');
CREATE TYPE mod_action     AS ENUM ('approve', 'mask', 'block', 'review', 'crisis');
CREATE TYPE content_type   AS ENUM ('post', 'comment', 'dm', 'artwork');

-- ============================================================
-- 1. 用户与监护
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role            user_role NOT NULL,
    -- [ENC] 以下 PII 字段以密文存储；display_name 为社区昵称（非实名）可明文
    display_name    TEXT NOT NULL,
    real_name_enc   BYTEA,                 -- [ENC] 实名（核验后加密）
    phone_enc       BYTEA,                 -- [ENC] 联系方式
    birth_date      DATE,                  -- 用于未成年人判定与适龄推荐
    is_minor        BOOLEAN GENERATED ALWAYS AS (birth_date > (CURRENT_DATE - INTERVAL '18 years')) STORED,
    -- 资质核验：疗愈师需持证
    cert_no_enc     BYTEA,                 -- [ENC] 疗愈师证书编号
    cert_verified   BOOLEAN NOT NULL DEFAULT FALSE,
    invite_code     TEXT,                  -- 封闭注册的邀请码（已核销）
    consent_self    BOOLEAN NOT NULL DEFAULT FALSE,  -- 本人知情同意
    consent_guardian BOOLEAN NOT NULL DEFAULT FALSE, -- 监护人知情同意（未成年人必需）
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ            -- 软删除，支持被遗忘权
);

-- 监护关系：家长 <-> 青少年，多对多（一个家长可绑定多个孩子）
CREATE TABLE guardianships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    teen_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relation        TEXT,                  -- 父/母/法定监护人
    verified_at     TIMESTAMPTZ,           -- 关系核验通过时间
    can_view_dm     BOOLEAN NOT NULL DEFAULT TRUE,
    can_approve_pay BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (parent_id, teen_id)
);

-- 无障碍偏好（驱动前端三通道反馈与适配）
CREATE TABLE accessibility_prefs (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    screen_reader   BOOLEAN DEFAULT FALSE,
    high_contrast   BOOLEAN DEFAULT FALSE,
    font_scale      NUMERIC(3,2) DEFAULT 1.0,
    captions_on     BOOLEAN DEFAULT TRUE,
    haptics_on      BOOLEAN DEFAULT TRUE,
    voice_control   BOOLEAN DEFAULT FALSE,
    tts_rate        NUMERIC(3,2) DEFAULT 1.0
);

-- ============================================================
-- 2. 订阅与支付
-- ============================================================
CREATE TABLE subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan                plan_type NOT NULL DEFAULT 'free',
    status              sub_status NOT NULL DEFAULT 'active',
    -- 未成年人订阅需家长确认，记录确认人
    guardian_approver   UUID REFERENCES users(id),
    current_period_end  TIMESTAMPTZ,
    provider            TEXT,              -- wechat_pay / alipay / apple / google
    provider_sub_id     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 权益快照：所有功能墙以此表为权威校验（前端仅做体验拦截）
CREATE TABLE entitlements (
    user_id             UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    ai_unlimited        BOOLEAN NOT NULL DEFAULT FALSE,
    ai_daily_quota      INT NOT NULL DEFAULT 3,    -- 免费版每日 AI 次数
    therapy_full        BOOLEAN NOT NULL DEFAULT FALSE,
    meditation_full     BOOLEAN NOT NULL DEFAULT FALSE,
    booking_1v1         BOOLEAN NOT NULL DEFAULT FALSE,
    storage_quota_mb    INT NOT NULL DEFAULT 200,
    family_space        BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 支付流水（幂等键防重复扣款）
CREATE TABLE payments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    subscription_id UUID REFERENCES subscriptions(id),
    amount_cents    INT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'CNY',
    provider        TEXT NOT NULL,
    provider_txn_id TEXT,
    idempotency_key TEXT UNIQUE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending', -- pending/succeeded/failed/refunded
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI 用量计数（用于免费额度限流，每日重置）
CREATE TABLE ai_usage_daily (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    usage_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    count           INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, usage_date)
);

-- ============================================================
-- 3. 创作工坊
-- ============================================================
CREATE TABLE artworks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT,
    kind            TEXT NOT NULL,         -- image / music / visualization
    -- 多模态产物存对象存储，这里存引用
    asset_url       TEXT,                  -- 主产物（图/音频）
    audio_thumb_url TEXT,                  -- 视障：音频缩略图
    caption_url     TEXT,                  -- 听障：字幕/可视化数据
    prompt          TEXT,                  -- 原始描述
    ai_alt_text     TEXT,                  -- AI 生成的语音深描文本（无障碍 alt）
    is_private      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI 调用日志（可观测、计费、审计）
CREATE TABLE ai_invocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    capability      TEXT NOT NULL,         -- speech2image / desc2music / visualize / lipread / artguide ...
    provider        TEXT,
    tokens_in       INT,
    tokens_out      INT,
    latency_ms      INT,
    success         BOOLEAN,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. 疗愈任务系统
-- ============================================================
CREATE TABLE therapy_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    level           TEXT NOT NULL,         -- 入门/进阶/挑战
    est_minutes     INT,
    source          TEXT NOT NULL DEFAULT 'ai', -- ai 自动推送 / therapist 手动调整
    assigned_by     UUID REFERENCES users(id),  -- 治疗师手动调整时记录
    assigned_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    completed_at    TIMESTAMPTZ
);

-- 情绪反馈（[DESENS] 脱敏：不存原始语音/表情，只存离散等级 + 不可逆引用）
CREATE TABLE mood_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mood_level      SMALLINT NOT NULL CHECK (mood_level BETWEEN 1 AND 5), -- [DESENS] 离散等级
    mood_tag        TEXT,                  -- [DESENS] 离散标签：平静/喜悦/焦虑...（非自由文本）
    source_ref_hash TEXT,                  -- [DESENS] 原始输入的不可逆哈希引用，不可还原
    logged_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 疗愈进度报告（聚合快照）
CREATE TABLE progress_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    streak_days     INT,
    completion_rate NUMERIC(4,3),
    mood_trend      SMALLINT[],            -- 已脱敏的等级序列
    summary         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1v1 疗愈师预约（订阅专享）
CREATE TABLE bookings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teen_id         UUID NOT NULL REFERENCES users(id),
    therapist_id    UUID NOT NULL REFERENCES users(id),
    start_at        TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'requested', -- requested/confirmed/done/canceled
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. 安全社区 + 审核
-- ============================================================
CREATE TABLE posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT,
    artwork_id      UUID REFERENCES artworks(id),
    -- 审核结果：发布即审，未通过不进入公共流
    mod_action      mod_action NOT NULL DEFAULT 'review',
    visible         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 私信（分级管控：青少年互发默认受限，疗愈师沟通全程留痕）
CREATE TABLE direct_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_id         UUID NOT NULL REFERENCES users(id),
    to_id           UUID NOT NULL REFERENCES users(id),
    body            TEXT,
    mod_action      mod_action NOT NULL DEFAULT 'review',
    -- 监护可见：青少年与他人的私信对其家长可见
    guardian_visible BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 审核记录（每条内容的判定留痕，供申诉/家长查看/合规审计）
CREATE TABLE moderation_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type    content_type NOT NULL,
    content_id      UUID NOT NULL,
    author_id       UUID REFERENCES users(id),
    action          mod_action NOT NULL,
    risk_score      NUMERIC(4,3),
    categories      JSONB,                 -- {"bully":0.9,"selfharm":0.1,...}
    reason          TEXT,
    reviewed_by     UUID REFERENCES users(id), -- 人工复核员（review 通道）
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 危机干预事件（自伤/自杀倾向走特殊通道）
CREATE TABLE crisis_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    trigger_content UUID,                  -- 关联内容
    notified_therapist BOOLEAN DEFAULT FALSE,
    notified_guardian  BOOLEAN DEFAULT FALSE,
    hotline_pushed     BOOLEAN DEFAULT FALSE,
    handled_by      UUID REFERENCES users(id),
    handled_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 6. 审计日志（全链路留痕，满足合规与可追溯）
-- ============================================================
CREATE TABLE audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    actor_id        UUID REFERENCES users(id),
    action          TEXT NOT NULL,         -- login / view_child_data / data_export / data_delete ...
    target          TEXT,
    ip_hash         TEXT,                  -- IP 脱敏存储
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 索引 ----------
CREATE INDEX idx_artworks_user      ON artworks(user_id);
CREATE INDEX idx_tasks_user_date    ON therapy_tasks(user_id, assigned_date);
CREATE INDEX idx_mood_user_time     ON mood_logs(user_id, logged_at);
CREATE INDEX idx_posts_visible      ON posts(visible, created_at DESC);
CREATE INDEX idx_mod_content        ON moderation_logs(content_type, content_id);
CREATE INDEX idx_dm_to              ON direct_messages(to_id, created_at DESC);

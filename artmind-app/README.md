# 心绘 ArtMind · 视听障碍青少年 AI 艺术疗愈订阅 APP

为视障 / 听障青少年打造的「无障碍 + AI 多模态」艺术疗愈平台。

本仓库已改造为**可完整运行在 Cloudflare 上的全栈应用**：

- **前端**：Cloudflare Pages 托管静态资源（`web/`）
- **后端**：Cloudflare Pages Functions（`functions/api/*`，Workers 运行时，ESM）
- **数据库**：Cloudflare D1（SQLite，`schema/d1.sql`）

> 渐进增强：前端在后端可用时使用服务端权威的额度 / 审核 / 订阅 / 社区；后端不可用（纯静态或 `file://`）时自动回退到内置演示逻辑，**功能永不中断**。

## 目录结构

```
artmind-app/
├── wrangler.toml            # Cloudflare Pages + D1 配置
├── package.json             # wrangler 脚本
├── schema/
│   └── d1.sql               # D1(SQLite) 表结构 + 种子数据
├── functions/               # Pages Functions（自动映射为 /api/* 路由）
│   ├── _lib/                # 共享库（_ 前缀不成为路由）
│   │   ├── response.js      # JSON/CORS/用户解析
│   │   ├── entitlements.js  # 套餐与权益
│   │   ├── moderation.js    # 审核算法（Workers ESM）
│   │   └── db.js            # D1 数据访问层
│   └── api/
│       ├── me.js            # GET  /api/me       权益 + 今日额度
│       ├── ai.js            # POST /api/ai       AI 创作网关（服务端额度校验）
│       ├── moderate.js      # POST /api/moderate 发帖即审 + 危机干预 + 持久化
│       ├── feed.js          # GET  /api/feed     社区动态
│       └── subscribe.js     # POST /api/subscribe 订阅（未成年人家长确认）
├── web/                     # 前端静态资源（Pages 输出目录）
│   ├── index.html · styles.css · app.js · data.js
│   └── api.js               # 前端 API 客户端（带降级回退）
├── server/                  # 原始参考实现（Node/PostgreSQL，供对照，不参与部署）
└── docs/PRD.md              # 产品需求文档
```

## 本地一键运行（模拟 Cloudflare 环境）

前置：Node ≥ 18。所有命令在 `artmind-app/` 目录下执行。

```bash
# 1) 安装依赖（wrangler）
npm install

# 2) 初始化本地 D1 数据库（建表 + 种子数据）
npm run db:init:local

# 3) 启动本地开发服务器（同时跑静态资源 + Functions + 本地 D1）
npm run dev
# 打开终端提示的地址（默认 http://localhost:8788）
```

启动后，前端会自动探测 `/api/me`，成功即进入「全栈模式」：AI 额度、社区审核、订阅权益全部由服务端 + D1 处理并持久化（刷新页面数据不丢失）。

## 部署到 Cloudflare

```bash
# 1) 登录
npx wrangler login

# 2) 创建 D1 数据库，并把返回的 database_id 填入 wrangler.toml
npx wrangler d1 create artmind

# 3) 初始化线上 D1
npm run db:init:remote

# 4) 部署（首次会提示创建 Pages 项目）
npm run deploy
```

也可用 **Cloudflare Dashboard → Pages** 连接 Git 仓库：
- Build command：留空
- Build output directory：`web`
- 在项目设置里绑定 D1（变量名 `DB`，指向 `artmind` 数据库）

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/me` | 当前用户权益与今日 AI 剩余额度（功能墙权威） |
| POST | `/api/ai` | AI 多模态创作；文字/语音描述真实生图，服务端校验免费额度 / PRO 能力 |
| POST | `/api/moderate` | 发帖即审，命中危机走干预通道，结果持久化 |
| GET | `/api/feed` | 社区动态（家长角色可见被拦截记录） |
| POST | `/api/subscribe` | 订阅激活，未成年角色先经家长确认 |

请求通过请求头 `X-User-Id`（前端匿名生成并存 localStorage）与 `X-User-Role` 标识用户；这是原型的轻量方案，生产应替换为正式鉴权（如 Cloudflare Access / JWT）。

## 从 PostgreSQL 到 D1 的主要改动

| PostgreSQL | D1 (SQLite) 适配 |
| --- | --- |
| `ENUM` 类型 | `TEXT` + `CHECK` 约束 |
| `gen_random_uuid()` | 应用层 `crypto.randomUUID()` 生成主键 |
| `TIMESTAMPTZ` | `TEXT`（ISO 8601）+ `datetime('now')` |
| `BYTEA` / `JSONB` | `TEXT`（密文 base64 / JSON 字符串） |
| `BIGSERIAL` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| 数组 `SMALLINT[]` | JSON 字符串 |

安全语义保持不变：`[ENC]` 字段级加密、`[DESENS]` 情绪脱敏在应用层落地。

## 无障碍与安全约束落地

| 约束 | 落地点 |
| --- | --- |
| 无障碍设计规范 | `web/` 语义化 + `aria-live` 三通道反馈（语音+字幕+触觉）+ 高对比/字号 + 语音操控 |
| 未成年人数据加密 | `schema/d1.sql` 中 `[ENC]` 字段、`guardianships` 双同意 |
| AI 情绪数据脱敏 | `mood_logs` 仅存离散等级 + 不可逆哈希（`[DESENS]`） |
| 内容安全 | `functions/api/moderate.js` + `_lib/moderation.js`，自伤倾向危机干预 |
| 降低操作门槛 | 语音一键操控、≥44px 触控目标、手势均有按钮替代 |

## 注意事项

- 语音合成 / 识别依赖浏览器能力（Chrome / Edge 最佳）；不支持时所有功能均有按钮替代。
- 创作工坊通过 Pollinations 公共服务生成真实画作，无需 API Key；包含自动、水彩、卡通、蜡笔、油画、像素六种画风，以及作品集、朗读、重画与下载。
- Pollinations 是外部公共服务，生成速度和可用性受其服务状态影响；生产商业化时建议在 `functions/api/ai.js` 中替换为具备 SLA 和内容安全承诺的模型供应商。
- 订阅支付当前仍是演示激活流程；正式上线前需接入支付回调、验签和退款逻辑。
- `server/` 目录是最初的 Node/PostgreSQL 参考实现，保留用于对照，**不参与 Cloudflare 部署**。

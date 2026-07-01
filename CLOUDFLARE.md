# Cloudflare Pages + GitHub 部署配置

连接 GitHub 后构建失败，**99% 是因为 Deploy command 填错了**。

## 错误原因

你当前配置的是：

```bash
npx wrangler deploy
```

这是 **Worker** 命令，不是 **Pages** 命令。并且仓库根目录没有 `web/` 静态文件（代码在 `artmind-app/` 子目录），所以会报：

> Could not detect a directory containing static files

---

## 推荐方案（Dashboard 自动构建，不要用 wrangler deploy）

在 Cloudflare Dashboard → **Workers & Pages** → 项目 **cureblue** → **Settings** → **Build**：

| 配置项 | 填写 |
| --- | --- |
| **Root directory（根目录）** | `artmind-app` |
| **Build command（构建命令）** | **留空** |
| **Build output directory（输出目录）** | `web` |
| **Deploy command（部署命令）** | **删除 / 留空** |

保存后点击 **Retry deployment** 重新部署。

> 若 Dashboard 里找不到 Deploy command 字段，说明使用的是旧版构建；只需设置 Root directory 和 Build output 即可。

Functions 会自动从 `artmind-app/functions/` 加载。

### D1 绑定（API 必须）

**Settings** → **Functions** → **D1 database bindings**：

- Variable name: `DB`
- D1 database: `artmind`

---

## GitHub Actions 自动部署（已配置 workflow）

仓库已包含 `.github/workflows/deploy-cloudflare.yml`。

在 GitHub → **Settings** → **Secrets and variables** → **Actions** 添加：

| Secret | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需 Pages Edit 权限） |
| `CLOUDFLARE_ACCOUNT_ID` | `66ec738594fc1e88e02ade2250b6e4ae` |

添加后推送 `main` 分支即可自动部署，无需 Dashboard 里的 Deploy command。

---

## 备选方案（必须用自定义 Deploy command 时）

**不要**用 `npx wrangler deploy`。

在仓库根目录使用：

```bash
npm run deploy
```

或直接：

```bash
cd artmind-app && npx wrangler pages deploy web --project-name=cureblue
```

此时 Root directory 可留空（仓库根目录），Deploy command 填上面其中一条。

---

## 验证部署成功

1. 打开 Pages 域名，页面正常显示
2. 访问 `https://你的域名/api/me`，应返回 JSON：`{"ok":true,...}`

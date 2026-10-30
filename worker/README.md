# 云端运行时（worker/）

一个 Cloudflare Worker + R2，两个域名：

| 域名 | 身份 | 发什么 |
| --- | --- | --- |
| `artifact.tianyw0.xyz` | 应用源（要登录） | SPA（`env.ASSETS`）、`/api/*`、`/auth/*`、`/cli/*` |
| `artifact-files.tianyw0.xyz` | 文件源（**没有页面、没有接口**） | 只认 `/f/<令牌>/<相对路径>` |

## 接口

```
GET  /api/meta            门禁开着没有、能不能写
GET  /api/state           layout.json + 每块画框 mtime + filesBase
GET  /api/tree            文件清单
GET  /api/file?path=…     读单个文件
POST /api/file?path=…     写单个文件（删用 &op=delete）
POST /api/files           整包导入（CLI push 走这条）
POST /api/cli/token       一次性 code 换 CLI token
GET  /auth/google(/callback)
GET  /cli/authorize · /cli/approve
```

写操作一律 `POST`（Cloudflare 在边缘挡 `PUT`/`PATCH`/`DELETE`）；接口路径别带 `config`（WAF）。

## 登录与密钥

- Google OAuth：`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`；
- 白名单：`ALLOWED_EMAILS`（逗号分隔）或 `ALLOWED_DOMAIN`；
- 会话签名与文件令牌：`SESSION_SECRET`（不设则复用 Google client secret）；
- 没配 Google 时是本地开发模式（全放开），`wrangler dev --var DEV:1` 时文件源走同源 `/f/`。

本地写仓库根 `.dev.vars`（已 gitignore）；线上用 `wrangler secret put <名字>`。

## 安全

1. 画框 iframe 永远 `sandbox=""`，不加 `allow-same-origin`；
2. 画框文档带 CSP：`script-src 'none'`、`connect-src 'none'`，只放行文件源与 `data:`；
3. 文件源只发 `artboards/`、`assets/`；`layout.json`、`context.md` 一律 403；
4. CLI token 只存哈希（`auth/tokens/<sha256>`），一次性 code 存 `auth/codes/<code>`，10 分钟、用后即焚。

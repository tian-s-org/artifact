# 云端画布（apps/cloud）

一个 Cloudflare Worker + R2：前端就是 `apps/local` 那同一份 SPA，打包进 `web/`，存储与项目仓库换成 R2 实现。
画布内容仍然由 Agent 写文件——本地写目录，云端写 HTTP 接口。

线上：`https://artifact.tianyw0.xyz`（`/p/<项目 id>` 进画布）。

## 两个域名，两种信任

| 域名 | 身份 | 发什么 |
| --- | --- | --- |
| `artifact.tianyw0.xyz` | 应用源（有门禁） | SPA（`env.ASSETS`）、`/api/*` |
| `artifact-files.tianyw0.xyz` | 文件源（**没有页面、没有接口**） | 只认 `/f/<项目 id>/<令牌>/<相对路径>` |

前端从 `/api/projects/:pid` 拿到 `filesBase`（文件源上的带令牌地址），画板 iframe 因此**跨源**加载。
云端没有长连接，前端改成每 2.5 秒拉一次项目快照，diff 出与本地 SSE 同一组事件。

## 沙箱怎么做的

Agent 产出的 HTML 按不可信内容处理，四道门都得过：

1. **iframe `sandbox=""`**——不透明源、不执行脚本、不读认证信息。永不加 `allow-same-origin`。
2. **独立源**——画板不在应用源上，同源读 Cookie / `parent.document` 无从谈起；文件源上没有 HTML 页面，也没有接口。
3. **路径里的项目令牌**——`HMAC-SHA256(FILES_SECRET, "artifact-files:<项目 id>")` 前 32 位十六进制。
   放在路径里是为了让画板的相对资源（`../../assets/…`）自动带上它；令牌错了 403。
4. **白名单 + CSP**——文件源只放行 `artboards/`、`assets/`、`design-system/` 下的静态资源；
   画板文档回 `default-src 'none'; img-src <文件源> data: blob:; font-src …; style-src 'unsafe-inline' …;
   script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; sandbox`，外加 `nosniff`。

应用源自身有门禁：`SITE_KEY` 通过 `?k=` 进来一次，换成一年期的 `HttpOnly; Secure; SameSite=Lax` Cookie `artifact_key`；
Agent 与脚本用 `Authorization: Bearer <SITE_KEY>`，不需要 Cookie。

## 接口

与本地版逐条一致的部分见仓库根 README；云端多出来的：

```
GET  /api/meta                                  { cloud: true, gated, canWrite }
GET  /api/projects/:pid/tree                    项目文件树
GET  /api/projects/:pid/file?path=…             读单个文件
POST /api/projects/:pid/file?path=…             写单个文件 { path?, content, encoding?: 'base64' }
POST /api/projects/:pid/file?path=…&op=delete   删文件
POST /api/projects/:pid/files                   整包导入 { files[], createProject, name }
GET  /f/:pid/:token/*                           画板与资源（文件源）
```

写接口都要 `Authorization: Bearer`。

### 为什么写操作全用 POST

Cloudflare 在边缘就把 `PUT` / `PATCH` / `DELETE` 挡掉（连不存在的路径都回 403 的 CF 页面，根本到不了 Worker），
所以云端只认 `POST`；本地服务同样接受 `POST`，前端一份代码两边跑。
接口名也别带 `config` 字样——`/api/config` 会被 WAF 拦，所以叫 `/api/meta`。

## 部署

```bash
pnpm --filter @artifact/cloud build:web        # 打包 SPA 到 apps/cloud/web（gitignore）
pnpm cloud:deploy                              # typecheck + build:web + wrangler deploy
pnpm cloud:push brand architecture web-ui      # 把本地 projects/ 推上去
pnpm --filter @artifact/cloud smoke            # 真浏览器冒烟：3 块画板、沙箱、改文件自动刷新
```

密钥（`wrangler secret put` 上传，本地写在 `apps/cloud/.dev.vars`，已 gitignore）：

| 变量 | 用途 |
| --- | --- |
| `SITE_KEY` | 门禁钥匙：`?k=` 链接与 Bearer |
| `FILES_SECRET` | 文件源令牌的 HMAC 密钥；换掉后旧画板链接立即失效 |

轮换 `FILES_SECRET` 不影响数据：前端每次取项目详情都会重新算令牌。

绑定：R2 桶 `artifact`、静态资源 `./web`（`run_worker_first: true`、`single-page-application`），
两个自定义域名在同一 Worker 上，由 `APP_HOST` / `FILES_HOST` 分派。

## 已知限制

- 变更通知靠 2.5 秒轮询，不是推送（Workers 没有长连接）。画板数量多了要换成 Durable Object。
- 单文件 8MB、单次导入 200 个文件。
- 单租户：一把 `SITE_KEY` 管所有项目，没有账号体系；文件令牌按项目分，但没有按人分。
- `wrangler dev` 没有绑自定义域名，前端会退化到应用源的 `/f/` 同源兜底路径。

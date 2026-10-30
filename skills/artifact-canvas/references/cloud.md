# 云端：登录、接口、文件源

一个部署一块画布。地址默认 `https://artifact.tianyw0.xyz`，可用 `--url` 或 `ARTIFACT_URL` 覆盖。

## 登录

```bash
npx @tian-s-org/canvas login      # 打开浏览器 → Google 授权 → 本机存 token
npx @tian-s-org/canvas logout
```

- token 存在 `~/.config/artifact/credentials.json`（0600）；
- `push` 自动用它；也可以用环境变量 `ARTIFACT_KEY` 覆盖；
- 服务端只存 token 的哈希（R2 `auth/tokens/<hash>`），可在 Web 上撤销。

## 写接口

`push` 走的就是下面这条；只改一个文件也可以直接调：

```bash
BASE=https://artifact.tianyw0.xyz
H="authorization: Bearer $ARTIFACT_KEY"

curl -s "$BASE/api/state" -H "$H"                       # layout + 每块画框 mtime + filesBase
curl -s "$BASE/api/tree" -H "$H"                        # 云端有哪些文件
curl -s "$BASE/api/file?path=artboards/board-001/index.html" -H "$H"        # 读
curl -s -X POST "$BASE/api/file?path=layout.json" -H "$H" -H 'content-type: application/json' \
  -d '{"content":"{…}"}'                                                     # 写
curl -s -X POST "$BASE/api/files" -H "$H" -H 'content-type: application/json' \
  -d '{"files":[{"path":"artboards/board-001/index.html","content":"<html>…</html>"}]}'   # 整包
```

- **写操作一律 `POST`**：Cloudflare 在边缘挡 `PUT`/`PATCH`/`DELETE`；删文件用 `POST …/file?path=…&op=delete`。
- 二进制（图片、字体）用 `{"content":"<base64>","encoding":"base64"}`。
- 可写路径：`layout.json`、`context.md`、`artboards/**`、`assets/**`。
- 单文件 ≤ 8MB，一次 ≤ 200 个文件；第一次推送必须包含 `layout.json`。

## 文件源

画框 iframe 从独立源加载：`https://artifact-files.tianyw0.xyz/f/<令牌>/<相对路径>`。

- 令牌由服务端派生（`SESSION_SECRET` / Google client secret 做 HMAC），前端每次读 `/api/state` 都重新拿；
- 只发 `artboards/`、`assets/`；`layout.json`、`context.md` 一律 403；
- 响应带沙箱 CSP（`script-src 'none'`、`connect-src 'none'`），图片/字体允许本项目与 `data:`。

## 刷新

页面每 2.5 秒轮询 `/api/state`，只换 mtime 变化的那一块画框（`?v=<mtime>`）。写完稍等一下再看。

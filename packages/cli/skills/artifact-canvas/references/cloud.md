# 云端接口

项目在 `https://artifact.tianyw0.xyz` 上、没有本地目录时用这一套。规则和本地一样：画板无脚本、不引用外网、资源用相对路径。

密钥问用户要，用 `Authorization: Bearer <SITE_KEY>`，别写进仓库：

```bash
BASE=https://artifact.tianyw0.xyz/api/projects/<项目 id>
H="authorization: Bearer $ARTIFACT_KEY"

curl -s "$BASE/tree" -H "$H"                                      # 文件树
curl -s "$BASE/file?path=artboards/board-001/index.html" -H "$H"   # 读
curl -s -X POST "$BASE/file" -H "$H" -H 'content-type: application/json' \
  -d '{"path":"artboards/board-001/index.html","content":"<html>…</html>"}'   # 写
```

- **写操作一律 `POST`**：Cloudflare 在边缘就挡 `PUT`/`PATCH`/`DELETE`。删文件用
  `POST "$BASE/file?path=…&op=delete"`。
- 二进制（图片、字体）用 `{"content":"<base64>","encoding":"base64"}`。
- 新建画板：先 `POST /api/projects/<pid>/boards`，再写它的 `index.html`。
- 写 `canvas.json` 时它的 `id` 必须等于项目 id，否则 400。
- 云端靠轮询（约 2.5 秒）刷新，写完稍等一下再看画布。

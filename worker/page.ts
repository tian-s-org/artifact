/** 几个极简页面：未登录、CLI 授权。不做表单，按钮就是链接。 */
const STYLE = `
  :root { color-scheme: light dark; }
  body { margin: 0; height: 100vh; display: grid; place-items: center; background: #f5f4f1; color: #1c1c1e;
         font: 14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; text-align: center; }
  @media (prefers-color-scheme: dark) { body { background: #141414; color: #e8e6e3; } }
  main { max-width: 420px; padding: 24px; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 10px 0 0; color: #6e6e73; }
  .btn { display: inline-block; margin-top: 20px; padding: 8px 18px; border-radius: 8px;
         background: #007aff; color: #fff; text-decoration: none; font-weight: 500; }
  .btn.secondary { background: rgba(0,0,0,.08); color: inherit; margin-left: 8px; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; word-break: break-all; }
`

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 没有登录时看到的页面；loginUrl 为空说明这个部署没配 Google */
export function blockedPage(loginUrl: string | null): Response {
  const body = loginUrl
    ? `<h1>artifact</h1><p>需要登录才能查看这块画布。</p><a class="btn" href="${loginUrl}">用 Google 登录</a>`
    : `<h1>artifact</h1><p>画布需要通过专属链接访问。</p>`
  return page('artifact', body, 403)
}

/** CLI 授权页：确认允许本机命令行访问画布 */
export function authorizePage(input: { email: string; redirect: string; approveUrl: string }): Response {
  const body = `
    <h1>授权本地命令行</h1>
    <p>${input.email}，一个本地进程想访问这块画布。</p>
    <p><code>${input.redirect}</code></p>
    <a class="btn" href="${input.approveUrl}">允许</a>
    <a class="btn secondary" href="/">取消</a>`
  return page('授权本地命令行', body)
}

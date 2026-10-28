/** 没有钥匙时看到的页面。不做登录表单：密钥只从专属链接进来。 */
const BLOCKED_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>artifact</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; height: 100vh; display: grid; place-items: center; background: #f5f4f1; color: #1c1c1e;
         font: 14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; text-align: center; }
  @media (prefers-color-scheme: dark) { body { background: #141414; color: #e8e6e3; } }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 10px 24px 0; color: #6e6e73; }
</style>
</head>
<body>
<main>
  <h1>artifact</h1>
  <p>画布需要通过专属链接访问。</p>
</main>
</body>
</html>`

export function blockedPage(): Response {
  return new Response(BLOCKED_PAGE, {
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

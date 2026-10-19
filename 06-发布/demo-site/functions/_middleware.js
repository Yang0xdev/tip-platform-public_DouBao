// 访问门禁（Cloudflare Pages Functions，对自定义域名与 *.pages.dev 同时生效）
//
// 公开（对客终端与工具，白名单制）：
//   /live/client/  /live/advisor/  /live/admin/  /live/portal/
//   /advisor-ipad.html   /mac-vision.html
//   /mac-setup.command   /mac-setup.zip   /scan-sample.pdf
//   /api/*（客户端同源 API 代理）
//
// 受保护（默认拒绝，含总入口与全部早期原型/过程页）：
//   / 总入口，以及 client.html、admin.html、advisor.html、advisor-ai.html、
//   admin-ai.html、ai.html、install.html、knowledge-arch.html、
//   transaction-flow.html、ui-gallery.html 和任何未列出的路径
//   （防止 Cloudflare 对未知路径回退根 index 导致过程页泄露）。
//
// 账号口令存于 Pages 项目 Secret：AUTH_USER / AUTH_PASS（由用户自定义）。

const PUBLIC_PREFIXES = [
  "/live/client/",
  "/live/advisor/",
  "/live/admin/",
  "/live/portal/",
  "/api/"
];
const PUBLIC_EXACT = new Set([
  "/live/client",
  "/live/advisor",
  "/live/admin",
  "/live/portal",
  "/api",
  "/advisor-ipad",
  "/advisor-ipad.html",
  "/mac-vision",
  "/mac-vision.html",
  "/mac-setup.command",
  "/mac-setup.zip",
  "/scan-sample.pdf"
]);

function isPublic(pathname) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const p of PUBLIC_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized() {
  return new Response("401 未授权：该区域仅限内部访问。", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="HBWhere Internal", charset="UTF-8"',
      "Content-Type": "text/plain; charset=UTF-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store"
    }
  });
}

function checkAuth(request, env) {
  const user = env.AUTH_USER;
  const pass = env.AUTH_PASS;
  if (!user || !pass) return false;
  const header = request.headers.get("Authorization") || "";
  const m = /^Basic\s+(.+)$/.exec(header);
  if (!m) return false;
  let decoded;
  try {
    decoded = atob(m[1]);
  } catch {
    return false;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const u = decoded.slice(0, idx);
  const p = decoded.slice(idx + 1);
  return timingSafeEqual(u, user) && timingSafeEqual(p, pass);
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const { pathname } = new URL(request.url);

  if (isPublic(pathname)) {
    return next();
  }

  if (!checkAuth(request, env)) {
    return unauthorized();
  }

  const resp = await next();
  const out = new Response(resp.body, resp);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
}

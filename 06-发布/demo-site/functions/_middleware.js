// 访问门禁（Cloudflare Pages Functions，对自定义域名与 *.pages.dev 同时生效）
//
// 规则（用户最新口径）：
//   仅「平台总入口 /」及任何未列出的路径需要 Basic Auth；
//   全部终端（客户端/顾问/后台/服务方门户/视觉工具）与全部冻结 UI 页面公开。
//
// 「未列出路径默认拒绝」是为了堵住 Cloudflare 对未知路径回退根 index 的行为，
// 否则像 /live/zzz 会直接把总入口内容返回给未授权访客。
// 账号口令存于 Pages 项目 Secret：AUTH_USER / AUTH_PASS（由用户自定义）。

const PUBLIC_PREFIXES = [
  "/live/client/",
  "/live/advisor/",
  "/live/admin/",
  "/live/portal/",
  "/api/"
];
const PUBLIC_EXACT = new Set([
  "/live/client", "/live/advisor", "/live/admin", "/live/portal", "/api",
  // 冻结 UI 原型/说明页（.html 与扩展名形式都要放行）
  "/client", "/client.html",
  "/admin", "/admin.html",
  "/advisor", "/advisor.html",
  "/advisor-ai", "/advisor-ai.html",
  "/admin-ai", "/admin-ai.html",
  "/ai", "/ai.html",
  "/portal", "/portal.html",
  "/install", "/install.html",
  "/knowledge-arch", "/knowledge-arch.html",
  "/transaction-flow", "/transaction-flow.html",
  "/ui-gallery", "/ui-gallery.html",
  // 顾问 iPad 端
  "/advisor-ipad", "/advisor-ipad.html",
  // Mac 视觉工具
  "/mac-vision", "/mac-vision.html",
  "/mac-setup.command", "/mac-setup.zip", "/scan-sample.pdf"
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

  // 唯一受保护的公开页面是总入口 /；其余匹配均为未知路径，统一 401
  if (!checkAuth(request, env)) {
    return unauthorized();
  }

  const resp = await next();
  const out = new Response(resp.body, resp);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  return out;
}

// 全站访问门禁（Cloudflare Pages Functions 边缘中间件，对自定义域名与 *.pages.dev 同时生效）
//
// 公开白名单（唯一对客面）：
//   /live/client/ 及其全部静态资源（含 catalog 静态快照）
//   /api/*         客户端同源 API 代理
// 其余所有路径——总入口、原型页、顾问/后台/服务方门户、Mac 视觉工具、脚本——
// 一律 HTTP Basic Auth，未通过返回 401，且加 noindex 防止搜索引擎收录。
// 账号口令存于 Pages 项目 Secret：AUTH_USER / AUTH_PASS（wrangler pages secret put）。

const PUBLIC_PATH_PREFIXES = ["/live/client/"];
const PUBLIC_PATH_EXACT = new Set(["/live/client"]);

function isPublic(pathname) {
  if (PUBLIC_PATH_EXACT.has(pathname)) return true;
  if (pathname.startsWith("/api/") || pathname === "/api") return true;
  for (const p of PUBLIC_PATH_PREFIXES) {
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
  if (!user || !pass) return false; // 未配置 Secret 时宁可全开，避免误锁死；部署后务必确认
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

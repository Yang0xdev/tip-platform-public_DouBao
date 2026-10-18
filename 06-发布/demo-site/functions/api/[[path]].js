// 同源 API 代理：浏览器 → demo.hbwhere.com/api/* → Cloudflare 边缘 → tip-api.onrender.com
// 作用：消除跨域 CORS 预检，并把"客户端到 Render"的网络波动转移到 CF 骨干网。
const UPSTREAM = "https://tip-api-niy0.onrender.com";

async function handle(event) {
  const request = event.request;
  const url = new URL(request.url);
  const suffix = url.pathname.replace(/^\/api\/?/, "") + url.search;
  const target = `${UPSTREAM}/${suffix}`;
  const headers = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (["host", "cookie", "content-length"].includes(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  const method = request.method.toUpperCase();
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") init.body = await request.arrayBuffer();

  let resp;
  try {
    resp = await fetch(target, init);
  } catch (e) {
    return new Response(JSON.stringify({ message: "上游服务暂不可用，正在唤醒或网络波动，请重试" }), {
      status: 503,
      headers: { "content-type": "application/json" }
    });
  }
  const out = new Response(resp.body, { status: resp.status, statusText: resp.statusText });
  for (const [k, v] of resp.headers.entries()) {
    if (["content-encoding", "transfer-encoding", "connection", "content-length"].includes(k.toLowerCase())) continue;
    out.headers.set(k, v);
  }
  out.headers.set("Access-Control-Allow-Origin", url.origin);
  return out;
}

export const onRequest = (event) => {
  const request = event.request;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": new URL(request.url).origin,
        "Access-Control-Allow-Methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
        "Access-Control-Allow-Headers": "content-type,x-tip-realm,x-tip-user"
      }
    });
  }
  return handle(event);
};

/* 透明身份规划 PWA service worker（相对路径，随 /live/<app>/ 部署） */
const CACHE = "tip-pwa-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API 等跨域请求走网络，不缓存

  if (req.mode === "navigate") {
    // 页面：网络优先，离线回退缓存的 App 外壳
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(async () => {
          const fallback =
            (await caches.match("./index.html")) ||
            (await caches.match("./")) ||
            (await caches.match("."));
          console.log("[sw] offline navigate fallback:", fallback ? fallback.status : "MISS");
          return fallback;
        })
    );
    return;
  }

  // 静态资源：缓存优先，后台更新（stale-while-revalidate）
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});

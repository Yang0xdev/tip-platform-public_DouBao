// 保活 Render 免费实例：免费计划休眠后冷启动 30–60 秒，会拖慢首次访问。
// 若免费计划不支持 10 分钟级 cron，部署会被拒绝，再退回每小时一档。
const TARGETS = [
  "https://tip-api-niy0.onrender.com/health",
  "https://tip-api-niy0.onrender.com/v1/catalog/projects"
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        for (const url of TARGETS) {
          try {
            const r = await fetch(url);
            console.log("warm", url, r.status);
          } catch (e) {
            console.log("warm fail", url, String(e));
          }
        }
      })()
    );
  },
  async fetch() {
    return new Response("hbwhere-warm ok", { status: 200 });
  }
};

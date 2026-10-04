# UI/功能冻结增补 — PWA 免费可安装 v2.3

日期：2026-10-04　基线：v2.2

## 背景

暂不进行 Apple 付费操作。改为 PWA（渐进式 Web 应用），在手机与电脑上
均可免费安装为 App，无需 Apple Developer、无需 App Store。

## 新增内容

客户端、顾问端（06-发布/demo-site/live/{client,advisor}）注入：

1. **manifest.webmanifest**：独立名称、theme/background、standalone 全屏、
   192/512/maskable 三枚图标；
2. **service worker（sw.js，缓存 tip-pwa-v2）**：
   - 安装预缓存 App 外壳；
   - 导航请求网络优先、离线回退缓存外壳；
   - 静态资源 stale-while-revalidate；
   - 跨域 API 不缓存；
3. iOS/桌面安装所需 meta（apple-mobile-web-app-*、theme-color）；
4. 安装指引页 **install.html**，入口页 index.html 新增绿色特色卡。

## 安装方式（全部免费）

- iPhone/iPad：Safari 打开 App → 分享 → 添加到主屏幕 → 全屏运行；
- 电脑：Chrome/Edge 打开 → 地址栏「安装」→ 独立窗口应用；
- 离线：可打开已缓存页面；实时数据离线时如实提示网络错误、不造假数据。

## 走查结果（线上，零 pageerror）

- 客户端：manifest 3 图标、SW 激活（scope /live/client/）、离线外壳 PASS；
- 顾问端：manifest 3 图标、SW 激活（scope /live/advisor/）、离线外壳 PASS。

源文件：06-发布/pwa/{manifest.tmpl.json,sw.js,apply-pwa.sh,icon-*}。
注：每次 expo 重新导出 live 目录后，需重跑 apply-pwa.sh 再部署
（发布流水线待集成此步骤）。

## 冻结状态

PWA 安装能力自本说明发布起冻结，改动走变更控制。
现行版本序列：…v2.2 → **v2.3**。

# iPhone 真机 App 完整部署方案 v0.1

日期：2026-10-03
适用：客户端、顾问展业端（同一技术栈，两个 App，同一开发者账号）

## 0. 现状与结论

两端均为 Expo SDK 52 + React Native 0.76，**同一套代码已可导出 Web 与
原生 App**，无需重写。做成可安装 iPhone App 的标准路径是：

**Expo Prebuild（生成原生工程）→ EAS Build（云端编译签名）→
TestFlight（真机测试）→ App Store 审核上架 → EAS Update（后续热更新）**。

全程可不用 Mac（云端构建）；有 Mac 可本地 archive。

---

## 1. 前置条件

| 项 | 说明 | 成本/周期 |
|---|---|---|
| Apple Developer Program | 个人或公司账号，**99 美元/年** | 个人 1–2 天；公司 7–20 天 |
| 公司账号附加 | 邓白氏编码 D-U-N-S（免费申请）、营业执照、可核实电话、公司官网；卖家显示公司名 | D-U-N-S 约 7–14 天 |
| 个人账号 | 卖家显示个人姓名，上线快 | — |
| Mac | 仅本地构建需要；用 EAS 云端构建可不要 | — |
| App 素材 | 图标 1024×1024（无透明通道）、启动图、隐私政策 URL、用户协议 URL、商店截图 | — |

建议：先用**个人账号或公司账号走 TestFlight**（当天可装自己手机），
公司账号与中国区资质并行办理。

## 2. 原生工程与构建

- **Expo Prebuild（CNG）**：由 app.config 生成 `ios/` 原生工程，
  不手工维护原生代码，升级随 Expo；
- **EAS Build（推荐，云端）**：
  - 测试包：`eas build -p ios --profile preview`
  - 上架包：`eas build -p ios --profile production`
- 本地构建（需 Mac + Xcode）：`npx expo prebuild` →
  `cd ios && pod install` → Xcode → Archive。

## 3. 签名、Bundle ID

- Bundle ID：
  - 客户端 `com.sagebridge.tipclient`
  - 顾问端 `com.sagebridge.tipadvisor`
- 首次 `eas build` 选择 **EAS 托管签名**，自动生成发布证书与描述文件；
- 配置 App Store Connect API Key 后可自动上传 TestFlight；
- 测试设备：ad hoc 需登记 UDID；**TestFlight 无需登记**，推荐。

## 4. 分发路径

1. **TestFlight 内测**：包上传 App Store Connect → 填出口加密合规、
   年龄分级 → 加内部测试员（最多 100 人，立即可装）；
2. **TestFlight 外测**：最多 1 万人，首次需轻审核；
3. **App Store 正式版**：商店信息、截图（6.7″ 必选，其余按要求）、
   描述、关键词、**App 隐私标签**、审核备注（含演示账号）→
   提交审核（通常 1–3 天）→ 通过后发布。

## 5. 苹果审核要点（与本业务强相关）

- **账号**：有登录须在审核备注提供**演示账号**；保留游客浏览；
- **隐私**：隐私清单（Expo 已内置大部分）、只声明实际采集的数据；
  无 IDFA 广告追踪则不触发 ATT；
- **文案红线**：不得出现“包成功/获批率/内部关系”，与系统既有红线一致；
- **收款**：本 App 是线下专业服务、App 内不收数字商品费，
  现有“付款凭证上传/核验”属于线下服务凭证，一般可过；
  避免出现“去外部网站付款”类明显引导按钮；
- **加密声明**：仅用 HTTPS 属豁免，配置
  `ITSAppUsesNonExemptEncryption = false`；
- **中国区**：可能要求移民/出入境中介资质、境内可访问后端与 ICP 备案、
  个保法合规。**建议首发非中国区或先 TestFlight**，资质齐备后再上国区。

## 6. 后端配套（上架前硬门槛）

当前演示后端不满足真机长期使用，需两项升级：

1. **数据持久化（必须）**：现为内存存储、重启即重置。
   接入 **Neon Postgres（免费 0.5 GB）**，Prisma 已就绪、迁移已规划；
2. **API 常驻（建议）**：Render 免费实例 15 分钟休眠、冷启动 30–50 秒，
   真机体验差。建议：
   - 升级 Render Starter（约 7 美元/月，常驻）；或
   - 用 `api.hbwhere.com` 子域名 CNAME 到 Render；
3. **推送**：Expo Push Notifications（APNs 由 Expo 托管，免费）；
4. **环境变量**：`EXPO_PUBLIC_API_BASE` 指向正式 API；
   Feature Flag 关闭签证等未授权模块。

## 7. 版本与热更新

- **EAS Update**：JS/样式/文案可热更新、不走审核；
  不得用于改变核心功能或绕过审核；原生改动必须发新版；
- 版本：`version`（语义化，如 1.0.0）+ `buildNumber`（每次上传递增）。

## 8. 执行顺序（建议排期）

1. 注册 Apple Developer（公司账号同步申请 D-U-N-S）；
2. **接 Neon Postgres 并迁移数据**；确定 API 域名与是否升级 Render；
3. 完善 app.config：bundleId、版本、图标、启动图、权限用途文案；
4. `eas build --profile preview` → TestFlight 装自己手机验证；
5. 准备商店素材、隐私标签、审核备注（演示账号）；
6. `eas build --profile production` + `eas submit` → 审核 → 发布；
7. 顾问端重复 3–6（同一账号下第二个 App）。

## 9. 费用汇总（首年最小）

- Apple Developer：99 美元/年；D-U-N-S：免费；
- EAS Build：免费档（iOS 构建次数少、可排队）；付费约 19 美元/月起；
- Render：免费档可演示，**正式用建议 7 美元/月**；
- Neon Postgres：免费档；Cloudflare：免费；域名：已购。

> 结论：**最省钱当天可走通的路径 = Apple 账号 + EAS 免费档 +
> TestFlight + 现有免费后端**；正式上架前补齐 Neon 持久化与 API 常驻。

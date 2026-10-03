# TestFlight 安装操作清单（客户端，先装上自己 iPhone）

目标：不做 App Store 正式审核，先把 App 通过 TestFlight 装到自己手机。
仓库内构建配置已全部就绪（app.json / eas.json / 图标 / 启动图 / 加密声明，
已通过 `expo prebuild` 校验）。以下为需要你亲自完成的步骤。

## 一、准备账号（仅首次）

1. **加入 Apple Developer Program**：https://developer.apple.com/programs/
   99 美元/年；个人账号最快 1–2 天。付款人信息与 Apple ID 一致。
2. **注册免费 Expo 账号**：https://expo.dev/signup
3. **App Store Connect 建 App 记录**：https://appstoreconnect.apple.com
   - 「我的 App」→ ＋ → 新建 App；
   - 平台 iOS，名称「透明身份规划」，语言简体中文，
   - **套装 ID（Bundle ID）选 `com.tip.client`**（若下拉没有，先在
     developer.apple.com → Certificates, Identifiers → Identifiers 注册
     该 App ID），SKU 随意填如 `tipclient001`。

## 二、在你自己电脑执行（Windows/Mac 均可，需安装 Node.js LTS）

> 代码目录：`05-代码/apps/client-app`（从 Gitee 拉取最新）。

```bash
# 1. 登录 Expo（浏览器会弹出授权）
npx eas-cli@latest login

# 2. 首次关联项目（一路回车/确认）
npx eas-cli@latest build:configure

# 3. 构建 iOS 上架包（云端编译，约 15–30 分钟）
npx eas-cli@latest build --platform ios --profile preview
```

第 3 步首次会问是否生成 iOS 证书/描述文件：**选 Yes，由 EAS 托管**；
中途要求登录 Apple ID（带 2FA），按提示完成即可（证书自动生成）。
构建结束会得到一个构建链接（.ipa）。

## 三、上传 TestFlight 并安装

```bash
# 上传刚构建的包到 App Store Connect
npx eas-cli@latest submit --platform ios --latest
```

首次提交按提示输入 Apple ID（如 rj.yang.bj@gmail.com）、团队 ID、
App 专用密码（https://appleid.apple.com → 登录 → App 专用密码）。

- 上传后苹果处理约 10–30 分钟，收到「可测试」邮件；
- iPhone 在 App Store 安装 **TestFlight**；
- 打开 TestFlight → 看到「透明身份规划」→ 安装。
- 内测员无需审核，装上即用。

## 四、说明（当前版本）

- App 数据来自现有演示 API（Render），**重启后数据会重置**——仅用于
  安装验证与演示；真机长期使用前接 Neon Postgres（下一步）。
- 若打开 App 时 API 冷启动，等待 30–50 秒属正常（免费实例休眠）。
- 顾问端流程相同，后续用 Bundle ID `com.tip.advisor` 重复一次。

## 五、可选：由我在云端代跑

如你希望我直接在云端完成构建与提交，需要你提供：
- Expo Access Token（expo.dev → Settings → Access Tokens）；
- 并在首次 iOS 证书环节按我引导完成一次 Apple 授权。
出于账号安全，更推荐你按上面清单在本机执行；我可全程协助排错。

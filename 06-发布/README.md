# 公网演示发布说明

## 访问地址

**https://demo.hbwhere.com**

## 架构（全部免费，域名费用除外）

| 角色 | 服务 | 说明 |
|---|---|---|
| 域名 / DNS | 阿里云 hbwhere.com | 仅新增一条 CNAME：`demo` → `hbwhere-demo.pages.dev`；未改 NS、未动 www 及其他记录 |
| 部署 / 托管 / CDN / HTTPS | Cloudflare Pages（免费） | 项目 `hbwhere-demo`；自定义域名 `demo.hbwhere.com`，证书自动签发续期 |
| 代码管理 | Gitee `transparent-identity-platform` | 唯一代码与产物仓库 |

## 页面

| 路径 | 内容 |
|---|---|
| / | 演示入口页 |
| /client | 客户端高保真 v1.3（24 视图） |
| /advisor | 顾问展业端手机（13 视图） |
| /advisor-ipad | 顾问展业端 iPad |
| /admin | 总后台 A01–A12 |
| /portal | B2B 服务方受控门户 |

## 更新发布

```bash
bash 06-发布/deploy-pages.sh
```

- Cloudflare Token 仅存于本机 `~/.cf/token`（chmod 600），**不在仓库中**；
- Account ID：8c5ca3dd5c0ed446e027a96ac5424be1（非密钥）；
- Pages 对 `.html` 自动 308 为无后缀干净 URL，站内链接使用干净 URL；
- 发布后可在 Cloudflare 控制台随时删除 Token / 项目。

## 冻结基线

视觉唯一真源：`04-UI设计/hifi/`（UI Freeze v1.3，tag `hifi-v1.3`）。发布包由冻结文件复制生成，不得手工改版。

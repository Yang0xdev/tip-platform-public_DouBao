# UI/功能冻结增补 — 服务方门户实时化 v2.2

日期：2026-10-03　基线：v2.1

## 一、修复（真实缺陷）

门户伙伴侧身份解析：伙伴控制器以登录名（login，如 PA-DEMO）作为身份，
而 PortalService.requireAcc 此前仅按内部编号（PA-xxxx）查找，导致伙伴端
全部接口返回 43401。已改为内部编号与登录名均可解析（管理侧仍用编号）。

## 二、新增：实时服务方门户（apps/portal-web，Vite + React）

入口：https://demo.hbwhere.com/live/portal/ （演示账号 PA-DEMO）

四个功能区全部接入实时 API：

1. **可见案件**：GET /portal/cases — 批次授权并集，仅实名+MFA 且授权
   有效期内可见；无全局案件列表。
2. **受控阅读器**：POST /portal/reader → 预签名 2 分钟、逐页阅读留痕、
   页面带账号/机构水印；POST reader/:id/page 翻页；close 关闭；无裸文件。
3. **水印 PDF**：POST /portal/pdf — 返回带水印 PDF 引用与水印串，
   为唯一可下载形态。
4. **提交报告**：POST /portal/reports — 进入平台待核验队列（sp 级，
   对客标注“未经官方核验”），核验通过后才成为正式节点。

## 三、走查结果（线上，零 pageerror）

- STEP1 登录 + 可见 CASE-0001：PASS；
- STEP2 阅读器打开/翻页/关闭：PASS；
- STEP3 水印 PDF 申请：PASS；
- STEP4 报告提交待核验：PASS。

入口页 index.html「实时系统」专区已新增门户 tile。

## 四、冻结状态

门户实时功能自本说明发布起冻结，改动走变更控制。
现行版本序列：…v2.1 → **v2.2**。
至此「一后台 + 两终端 + B2B 受控门户」全部为实时可操作系统。

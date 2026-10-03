# UI/功能冻结增补 — 客户端材料上传 v2.0

日期：2026-10-03　基线：v1.9

## 本次新增（功能增量，不改动既有视觉）

### 1. 客户端材料上传（案件详情「我的材料」）

此前材料区只读，客户无法提交文件。现：

- 每个材料项按状态显示动作：
  - 待上传 →「上传文件」；
  - 需补充（supplement_needed/returned）→「补充上传」；
  - 审核中（submitted）→ 不显示按钮，提示等待审核；
  - 已通过（approved）→「提交新版本」（旧版自动标 superseded，不就地替换）。
- Web 端通过隐藏 `<input type="file">` 选文件，crypto.subtle 计算 SHA-256；
  提交 `POST /v1/materials/upload`（caseId/personRef/itemCode/fileHash/artifactRef/mime/sizeBytes）。
- 服务端既有校验全部生效：
  仅本人/授权成员/监护场景可提交；MIME 白名单（证件照仅 image/jpeg，
  其余 image/jpeg·application/pdf；银行流水仅 PDF）；>0 且 ≤20MB；
  任一失败整体失败、不写版本（不假成功）。
- 上传成功显「已提交，等待平台审核」，状态变「审核中」并刷新。
- 原生端（非 Web）文件选择器为后续开发项，当前显式提示，不伪装。

走查（线上）：
- 证件照上传 JPG → submitted，成功提示出现。PASS；
- PDF 上传证件照 → 422「仅支持 image/jpeg」（正确拦截）。PASS；
- 直接 API：id_card 上传 PDF → MAT-0003 submitted。PASS。

### 2. 修复时间线「Invalid Date」

- 对客时间线字段为 `at`，客户端误用 `occurredAt` 导致日期显示 Invalid Date。
- 已统一改为 `at`（类型 + 排序 + 展示）；走查显示正常日期（2026/10/3）。

## 验收口径

- client-app typecheck 通过；浏览器走查零 pageerror。
- 视觉沿用冻结 token（navy 上传按钮 14 圆角、卡片 18 圆角、paper 底）。

## 冻结状态

以上内容自本说明发布起冻结；改动走变更控制。
现行版本序列：…v1.9 → **v2.0**。

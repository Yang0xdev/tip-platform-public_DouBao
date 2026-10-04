#!/usr/bin/env bash
# 开发环境演示数据种子（仅 dev/test；生产 seed 必须为空，M5-11 有发布扫描断言）
# 用法：先启动 api（默认 http://localhost:3100），再运行本脚本
# 数据全部为虚构【示例】，用于后台页面走查，不代表真实项目/机构/政策。
set -uo pipefail
# M5-11 环境门：生产环境禁止执行示例 seed
if [ "${NODE_ENV:-}" = "production" ]; then
  echo "拒绝执行：生产环境零示例数据（M5-11）" >&2
  exit 2
fi
BASE="${BASE:-http://localhost:3100}"
A=(-H "content-type: application/json" -H "x-tip-realm: staff" -H "x-tip-user: s-author")
V=(-H "content-type: application/json" -H "x-tip-realm: staff" -H "x-tip-user: s-verifier")
C=(-H "content-type: application/json" -H "x-tip-realm: customer" -H "x-tip-user: c-1980")
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }

# 持久化幂等：数据库中已有服务状态时跳过示例 seed（避免重启后重复播种）
PSTATUS=$(curl -s "${V[@]}" "$BASE/v1/persistence/status")
POP=$(echo "$PSTATUS" | j ".get('populated',False)")
if [ "$POP" = "True" ]; then
  echo "检测到持久化状态已存在，跳过示例 seed（如需重播种请清空 service_states 表）"
  exit 0
fi

echo "== 境内机构（M1-01）"
ENT=$(curl -s "${A[@]}" -X POST "$BASE/admin/entities" -d '{"name":"示例出入境咨询（北京）有限公司","creditCode":"91110000EXAMPLE001","filingNo":"BJ-2026-018","filingExpiresAt":"2027-03-31","contactName":"李运营","contactPhone":"010-00000000"}')
ENT_ID=$(echo "$ENT" | j "['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/entities/$ENT_ID/active" >/dev/null
echo "  active entity: $ENT_ID"
curl -s "${A[@]}" -X POST "$BASE/admin/entities" -d '{"name":"示例寰宇顾问（上海）有限公司","creditCode":"91310000EXAMPLE002","note":"备案材料审核中"}' >/dev/null
echo "  pending entity created"

echo "== 收费方案版本（M1-04，四眼：A 编制提交，V 复核发布）"
FEE=$(curl -s "${A[@]}" -X POST "$BASE/admin/catalog/fee-schedules/drafts" -d '{
  "code":"FEE-TECH-RESIDENCE-A","title":"A国技术居留服务收费（示例）","body":"费用分项列示，异币种不相加。",
  "feeItems":[
    {"code":"platform_service","label":"平台服务费","nature":"platform_service","collector":"示例出入境咨询（北京）有限公司","currency":"CNY","amountMinor":3000000,"certainty":"confirmed"},
    {"code":"overseas_professional","label":"境外持牌方法律服务费","nature":"overseas_professional","collector":"示例境外律所A（持牌）","currency":"USD","amountMinor":450000,"certainty":"estimated"},
    {"code":"official_application","label":"官方申请费","nature":"official","collector":null,"collectorTbc":true,"currency":null,"amountMinor":null,"certainty":"tbc"}
  ]}')
FEE_ID=$(echo "$FEE" | j "['id']")
curl -s "${A[@]}" -X POST "$BASE/admin/catalog/fee-schedules/$FEE_ID/submit" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/catalog/fee-schedules/$FEE_ID/review" -H "content-type: application/json" -d '{"event":"approve"}' >/dev/null
echo "  published fee: $FEE_ID"

echo "== 事实核验台账（M1-03）"
VF=$(curl -s "${V[@]}" -X POST "$BASE/admin/verifications" -d '{"fact":"A国技术居留政策要求申请人具备合规雇主担保（示例事实）","factType":"policy","sourceType":"official_url","sourceRef":"https://example.gov/policy/example","sourcePublishedAt":"2026-08-01"}')
VF_ID=$(echo "$VF" | j "['id']")
echo "  verified fact: $VF_ID"

echo "== 项目版本两段发布（M1-02/05）"
PROJ=$(curl -s "${A[@]}" -X POST "$BASE/admin/catalog/projects/drafts" -d "{
  \"code\":\"PROJ-TECH-A\",\"title\":\"A国技术居留（示例）\",\"body\":\"面向合规技术岗位的居留路径介绍，不作任何结果承诺。\",
  \"keyFactIds\":[\"$VF_ID\"],\"feeScheduleId\":\"$FEE_ID\"}")
PROJ_ID=$(echo "$PROJ" | j "['id']")
curl -s "${A[@]}" -X POST "$BASE/admin/catalog/projects/$PROJ_ID/submit-verification" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/catalog/projects/$PROJ_ID/verification" -d '{"decision":"pass"}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/catalog/projects/$PROJ_ID/publication" -d '{"decision":"approve"}' | j "['state']"
echo "  published project: $PROJ_ID"

curl -s "${A[@]}" -X POST "$BASE/admin/catalog/projects/drafts" -d '{"code":"PROJ-DIGITAL-C","title":"C国数字游民（示例草稿）","body":"草稿内容，待核验。"}' >/dev/null
echo "  draft project created"

echo "== 初评问卷 + 结论模板 + 规则集发布（M1-07/08）"
QN=$(curl -s "${A[@]}" -X POST "$BASE/admin/assessment/templates/questionnaire/drafts" -d "{
  \"code\":\"QN-RESIDENCE\",\"title\":\"技术居留初评问卷（示例）\",\"content\":{\"questions\":[
    {\"code\":\"q_age\",\"group\":\"基本情况\",\"title\":\"你的年龄是？\",\"type\":\"number\",\"required\":true},
    {\"code\":\"q_education\",\"group\":\"基本情况\",\"title\":\"你的最高学历？\",\"type\":\"single\",\"required\":true,\"options\":[
      {\"value\":\"college\",\"label\":\"大专\"},{\"value\":\"bachelor\",\"label\":\"本科\"},
      {\"value\":\"master\",\"label\":\"硕士\"},{\"value\":\"phd\",\"label\":\"博士\"}]},
    {\"code\":\"q_employer\",\"group\":\"岗位与担保\",\"title\":\"是否已有合规雇主提供担保？\",\"type\":\"single\",\"required\":true,\"options\":[
      {\"value\":\"yes\",\"label\":\"是\"},{\"value\":\"no\",\"label\":\"否\"}]},
    {\"code\":\"q_offer\",\"group\":\"岗位与担保\",\"title\":\"是否已获得技术岗位聘用？\",\"type\":\"single\",\"required\":true,\"options\":[
      {\"value\":\"yes\",\"label\":\"是\"},{\"value\":\"no\",\"label\":\"否\"}]},
    {\"code\":\"q_income\",\"group\":\"岗位与担保\",\"title\":\"预计年薪（当地货币，示例数值）？\",\"type\":\"number\",\"required\":true},
    {\"code\":\"q_background\",\"group\":\"背景情况\",\"title\":\"是否可提供无犯罪记录？\",\"type\":\"single\",\"required\":true,\"options\":[
      {\"value\":\"yes\",\"label\":\"是\"},{\"value\":\"no\",\"label\":\"否\"}]}
  ]}}")
QN_ID=$(echo "$QN" | j "['id']")
curl -s "${A[@]}" -X POST "$BASE/admin/assessment/templates/$QN_ID/submit" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/assessment/templates/$QN_ID/review" -d '{"event":"approve"}' >/dev/null
echo "  questionnaire published: $QN_ID"

RT=$(curl -s "${A[@]}" -X POST "$BASE/admin/assessment/templates/result_template/drafts" -d "{
  \"code\":\"RT-RESIDENCE\",\"title\":\"技术居留结论模板（示例）\",\"content\":{\"blocks\":{
    \"eligible\":{\"title\":\"初步信息符合\",\"body\":\"你提供的信息与该路径已公示条件初步匹配；这是信息整理，不是资格认定，个案以官方审核为准。\"},
    \"gap\":{\"title\":\"存在明确差距\",\"body\":\"部分条件目前不满足，可查看差距项与方向提示；不代表无法弥补。\"},
    \"unconfirmed\":{\"title\":\"信息待确认\",\"body\":\"还有信息未提供，补全后可再次整理。\"},
    \"not_committed\":{\"title\":\"信息未完成\",\"body\":\"必填项未完成，暂不能形成整理结果。\"}
  },\"needsManualNote\":\"如需进一步解读，可联系顾问；结果不产生自动归属。\",\"noMatchNote\":\"当前试点暂无匹配路径时，请以官方渠道信息为准。\"}}")
RT_ID=$(echo "$RT" | j "['id']")
curl -s "${A[@]}" -X POST "$BASE/admin/assessment/templates/$RT_ID/submit" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/assessment/templates/$RT_ID/review" -d '{"event":"approve"}' >/dev/null
echo "  result template published: $RT_ID"

RL=$(curl -s "${A[@]}" -X POST "$BASE/admin/assessment/rulesets/drafts" -d "{
  \"projectCode\":\"PROJ-TECH-A\",\"ruleSet\":{\"projectCode\":\"PROJ-TECH-A\",\"requiredQuestions\":[
    \"q_age\",\"q_education\",\"q_employer\",\"q_offer\",\"q_income\",\"q_background\"],\"dimensions\":[
    {\"code\":\"d_age\",\"label\":\"年龄\",\"all\":[
      {\"questionCode\":\"q_age\",\"op\":\"gte\",\"value\":18},
      {\"questionCode\":\"q_age\",\"op\":\"lte\",\"value\":60}],
      \"evidenceVerificationIds\":[\"$VF_ID\"]},
    {\"code\":\"d_education\",\"label\":\"学历\",\"all\":[
      {\"questionCode\":\"q_education\",\"op\":\"in\",\"value\":[\"bachelor\",\"master\",\"phd\"]}],
      \"evidenceVerificationIds\":[\"$VF_ID\"],\"gapGuidance\":\"不同岗位对学历要求存在差异，可与顾问确认。\"},
    {\"code\":\"d_employer\",\"label\":\"雇主担保\",\"all\":[
      {\"questionCode\":\"q_employer\",\"op\":\"eq\",\"value\":\"yes\"}],
      \"evidenceVerificationIds\":[\"$VF_ID\"]},
    {\"code\":\"d_offer\",\"label\":\"岗位聘用\",\"all\":[
      {\"questionCode\":\"q_offer\",\"op\":\"eq\",\"value\":\"yes\"}],
      \"evidenceVerificationIds\":[\"$VF_ID\"]},
    {\"code\":\"d_income\",\"label\":\"薪资水平\",\"all\":[
      {\"questionCode\":\"q_income\",\"op\":\"gte\",\"value\":30000}],
      \"evidenceVerificationIds\":[\"$VF_ID\"]},
    {\"code\":\"d_background\",\"label\":\"背景情况\",\"all\":[
      {\"questionCode\":\"q_background\",\"op\":\"eq\",\"value\":\"yes\"}],
      \"evidenceVerificationIds\":[\"$VF_ID\"]}
  ]}}")
RL_ID=$(echo "$RL" | j "['id']")
curl -s "${A[@]}" -X POST "$BASE/admin/assessment/rulesets/$RL_ID/submit" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/assessment/rulesets/$RL_ID/review" -d '{"event":"approve"}' >/dev/null
echo "  ruleset published: $RL_ID"

echo "== 顾问入驻 + 授权（M1-07/09，顾问 adv-chen）"
CHEN=(-H "content-type: application/json" -H "x-tip-realm: staff" -H "x-tip-user: adv-chen")
OB=$(curl -s "${CHEN[@]}" -X POST "$BASE/advisor/onboarding/drafts" -d "{
  \"phone\":\"13800010001\",\"entityId\":\"$ENT_ID\",\"realName\":\"陈某\",\"materialRefs\":[\"l3://id-card\",\"l3://cert\"],
  \"selfIntro\":\"专注技术居留，材料透明。\",\"title\":\"资深顾问\",\"yearsOfPractice\":6,\"filingNo\":\"BJ-2026-018\"}")
OB_ID=$(echo "$OB" | j "['id']")
for k in no_private_collection no_offplatform_promise no_exaggeration confidentiality; do
  curl -s "${CHEN[@]}" -X POST "$BASE/advisor/onboarding/$OB_ID/commitment" -d "{\"key\":\"$k\"}" >/dev/null
done
curl -s "${CHEN[@]}" -X POST "$BASE/advisor/onboarding/$OB_ID/training" >/dev/null
curl -s "${CHEN[@]}" -X POST "$BASE/advisor/onboarding/$OB_ID/submit" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/advisors/$OB_ID/approve" >/dev/null
echo "  advisor onboarded: adv-chen ($OB_ID)"
curl -s "${CHEN[@]}" -X POST "$BASE/advisor/grants/PROJ-TECH-A/start" >/dev/null
for m in project_rules banned_words fee_script; do
  curl -s "${CHEN[@]}" -X POST "$BASE/advisor/grants/PROJ-TECH-A/confirm" -d "{\"materialKey\":\"$m\"}" >/dev/null
done
curl -s "${CHEN[@]}" -X POST "$BASE/advisor/grants/PROJ-TECH-A/submit" -d '{"requestedDays":500}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/advisors/grants/adv-chen/PROJ-TECH-A/approve" >/dev/null
echo "  grant authorized: adv-chen × PROJ-TECH-A"

echo "== 客户关系（M2-01/02，双向确认）"
C1=(-H "content-type: application/json" -H "x-tip-realm: customer" -H "x-tip-user: c-1980")
R1=$(curl -s "${C1[@]}" -X POST "$BASE/v1/engagements/capture" -d '{"source":"card_request","advisorId":"adv-chen","projectCode":"PROJ-TECH-A","note":"希望了解技术居留路径"}')
R1_ID=$(echo "$R1" | j "['consultation']['id']")
curl -s "${CHEN[@]}" -X POST "$BASE/advisor/engagements/$R1_ID/accept" >/dev/null
echo "  active: c-1980 × adv-chen（名片请求，客户直接发起）"
C2=(-H "content-type: application/json" -H "x-tip-realm: customer" -H "x-tip-user: c-2051")
R2=$(curl -s "${C2[@]}" -X POST "$BASE/v1/engagements/capture" -d '{"source":"card_appointment","projectCode":"PROJ-TECH-A"}')
R2_ID=$(echo "$R2" | j "['consultation']['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/engagements/$R2_ID/assign" -d '{"advisorId":"adv-chen"}' >/dev/null
curl -s "${C2[@]}" -X POST "$BASE/v1/engagements/$R2_ID/confirm-assignment" >/dev/null
curl -s "${CHEN[@]}" -X POST "$BASE/advisor/engagements/$R2_ID/accept" >/dev/null
echo "  active: c-2051 × adv-chen（平台分配，双向确认）"
# 待处理：一条待客户确认、一条待平台分配
C3=(-H "content-type: application/json" -H "x-tip-realm: customer" -H "x-tip-user: c-2049")
R3=$(curl -s "${C3[@]}" -X POST "$BASE/v1/engagements/capture" -d '{"source":"card_appointment","advisorId":"adv-chen","projectCode":"PROJ-TECH-A"}')
R3_ID=$(echo "$R3" | j "['consultation']['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/engagements/$R3_ID/assign" -d '{"advisorId":"adv-chen"}' >/dev/null
echo "  pending_accept（待客户确认）: c-2049"
C4=(-H "content-type: application/json" -H "x-tip-realm: customer" -H "x-tip-user: c-1902")
curl -s "${C4[@]}" -X POST "$BASE/v1/engagements/capture" -d '{"source":"card_appointment","projectCode":"PROJ-TECH-A"}' >/dev/null
echo "  pending_assign（待平台分配）: c-1902"

echo "== 方案→订单全链路（M2-04～10/13，影子环境，客户 c-1980）"
# 方案
PROP=$(curl -s "${CHEN[@]}" -X POST "$BASE/advisor/proposals/drafts" -d '{
  "customerRef":"c-1980","projectCode":"PROJ-TECH-A",
  "advice":[{"text":"技术居留公开路径的学历与雇主条件与本人情况匹配，建议准备学位认证。","sourceRef":"PROJ-TECH-A@v1#conditions"}],
  "responsibilities":"平台负责材料清单、进度提醒与受控登记，官方审核以当局为准。",
  "nonCommitments":["不承诺获批结果","官方费以递交时为准"]}')
PROP_ID=$(echo "$PROP" | j "['id']")
curl -s "${CHEN[@]}" -X POST "$BASE/advisor/proposals/$PROP_ID/submit" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/proposals/$PROP_ID/approve" >/dev/null
curl -s "${C1[@]}" -X POST "$BASE/v1/proposals/$PROP_ID/confirm" >/dev/null
echo "  proposal confirmed: $PROP_ID（确认即自动生成订单草稿）"
# 三要素配置（境外方=自营交付部门；收款户名=签约主体）
curl -s "${V[@]}" -X PUT "$BASE/admin/orders/config" -d '{
  "overseasParty":{"linked":true,"name":"自营交付部门","licensed":false},
  "payeeAccounts":[{"name":"示例出入境咨询（北京）有限公司","bank":"中国银行北京分行","account":"1100 0000 1234"}]}' >/dev/null
ORD_ID=$(curl -s "${V[@]}" "$BASE/admin/orders" | j "['records'][0]['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/orders/$ORD_ID/subject-check" >/dev/null
echo "  subject gate passed: $ORD_ID"
# 合同模板（五要素齐备）
TPL=$(curl -s "${V[@]}" -X POST "$BASE/admin/contract-templates/drafts" -d '{"title":"标准服务合同（示例）"}')
TPL_ID=$(echo "$TPL" | j "['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/contract-templates/$TPL_ID/update" -d '{"scope":true,"refund":true,"overseasNotice":true,"guarantee":true,"privacy":true}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/contract-templates/$TPL_ID/publish" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/orders/$ORD_ID/signing/start" -d "{\"templateId\":\"$TPL_ID\"}" >/dev/null
for k in fees non_commitment privacy; do
  curl -s "${C1[@]}" -X POST "$BASE/v1/orders/$ORD_ID/consents" -d "{\"key\":\"$k\"}" >/dev/null
done
SIGNED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s "${V[@]}" -X POST "$BASE/admin/orders/$ORD_ID/contract/register" -d "{\"signedAt\":\"$SIGNED_AT\",\"artifactRef\":\"l3://signed/$ORD_ID.pdf\",\"registrarId\":\"s-verifier\"}" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/orders/$ORD_ID/make-effective" >/dev/null
echo "  order effective（影子）: $ORD_ID"
# 首付：客户查看计划与对公账户 → 上传凭证（待核验）→ 财务双人核验 → 开收据（M2-11）
curl -s "${C1[@]}" "$BASE/v1/orders/$ORD_ID/payment-plan" >/dev/null
curl -s "${C1[@]}" -X POST "$BASE/v1/orders/$ORD_ID/payment-vouchers" -d '{
  "installmentSeq":1,"fileHash":"seed-voucher-0001","artifactRef":"l3://vouchers/seed-0001.jpg",
  "amountMinor":"3000000","currency":"CNY"}' >/dev/null
echo "  voucher uploaded（pending_verify，待核验≠到账）"
curl -s "${V[@]}" -X POST "$BASE/admin/payments/$ORD_ID/verify" -d '{
  "installmentSeq":1,"decision":"verified","secondVerifierId":"s-finance2"}' >/dev/null
RCP_ID=$(curl -s "${V[@]}" "$BASE/admin/payments/receipts" | j "['records'][0]['id']")
echo "  receipt issued: $RCP_ID；订单进入待建案（M3 建案）"

echo "== dev seed 完成（重跑会因唯一编码报错属正常，内存仓储重启即清空）"

# ===== M3 切片5-9 示例：服务方准入 + 门户账号批次 + 通知模板 =====
CASE_ID=$(curl -s "${V[@]}" "$BASE/admin/cases/board" | j "['columns'][0]['cases'][0]['id']")
SP_ID=$(curl -s "${A[@]}" -X POST "$BASE/admin/providers" -d '{
  "type":"inhouse_delivery","mode":"in","name":"自营交付部门"
}' | j "['id']")
curl -s "${A[@]}" -X POST "$BASE/admin/providers/$SP_ID/license" -d '{
  "credentialNo":"REG-DEMO-1","country":"PT",
  "issuedAt":"2026-01-01T00:00:00Z","expiresAt":"2027-06-01T00:00:00Z"
}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/providers/$SP_ID/license/verify" -d '{}' >/dev/null
for K in framework dataProcessing confidentiality serviceLevel; do
  curl -s "${A[@]}" -X POST "$BASE/admin/providers/$SP_ID/agreement" -d "{\"key\":\"$K\"}" >/dev/null
done
curl -s "${A[@]}" -X POST "$BASE/admin/providers/$SP_ID/submit" -d '{}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/providers/$SP_ID/review" -d '{"decision":"active"}' >/dev/null
echo "  provider active: $SP_ID（A02 准入）"

# 材料清单 + 客户上传 + 平台审核（走真实门）
curl -s "${V[@]}" -X POST "$BASE/admin/materials/checklist" -d "{\"caseId\":\"$CASE_ID\"}" >/dev/null
MAT_ID=$(curl -s "${V[@]}" "$BASE/admin/materials?caseId=$CASE_ID" | j "['records'][0]['id']")
curl -s "${C[@]}" -X POST \
  "$BASE/v1/materials/upload" -d "{
    \"caseId\":\"$CASE_ID\",\"personRef\":\"c-1980\",\"itemCode\":\"passport\",
    \"fileHash\":\"hash-demo-1\",\"artifactRef\":\"L3://p1.jpg\",
    \"mime\":\"image/jpeg\",\"sizeBytes\":102400
  }" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/materials/$MAT_ID/review" -d '{"decision":"approve"}' >/dev/null
echo "  material approved: $MAT_ID（材料中心）"

# 门户账号 + 批次授权
ACC_ID=$(curl -s "${V[@]}" -X POST "$BASE/admin/portal/accounts" -d "{
  \"providerId\":\"$SP_ID\",\"login\":\"PA-DEMO\",\"name\":\"示例律师\"
}" | j "['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/portal/accounts/$ACC_ID/setup" -d '{"step":"realname"}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/portal/accounts/$ACC_ID/setup" -d '{"step":"mfa"}' >/dev/null
GR_ID=$(curl -s "${V[@]}" -X POST "$BASE/admin/portal/grants" -d "{
  \"providerId\":\"$SP_ID\",\"caseId\":\"$CASE_ID\",
  \"materialScopes\":[\"passport\"],\"actions\":[\"material_view\",\"report_upload\"]
}" | j "['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/portal/grants/$GR_ID/approve-view" -d '{}' >/dev/null
echo "  portal grant viewable: $GR_ID（批次授权）"

# 通知模板（草稿→提交→发布）
TPL_ID=$(curl -s "${V[@]}" -X POST "$BASE/admin/notifications/templates" -d '{
  "code":"t0_demo","category":"t0","title":"材料补充提醒",
  "body":"请在截止前补充材料","safeSummary":"请补充材料","channels":["app","sms"]
}' | j "['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/notifications/templates/$TPL_ID/submit" -d '{}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/notifications/templates/$TPL_ID/review" -d '{"decision":"published"}' >/dev/null
echo "  notification template published: $TPL_ID"

# ============ M4：工单/投诉、佣金结算、退款 ============
# 普通咨询工单
curl -s -H "content-type: application/json" -H "x-tip-realm:customer" -H "x-tip-user:c-1980" -X POST "$BASE/v1/tickets" -d '{
  "kind":"consult","title":"材料清单咨询","description":"想确认银行流水的月份范围"
}' >/dev/null
# 投诉工单（平台外交易线索 → 自动合规事件 + 被投诉顾问停新）
TKT_ID=$(curl -s -H "content-type: application/json" -H "x-tip-realm:customer" -H "x-tip-user:c-1980" -X POST "$BASE/v1/tickets" -d '{
  "kind":"complaint","complaintCategory":"off_platform_deal","respondentAdvisorId":"adv-chen",
  "orderId":"ORD-0001","title":"被要求私下转账","description":"顾问让我把服务费转到他个人账户，承诺包成功"
}' | j "['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/tickets/$TKT_ID/accept" -d '{}' >/dev/null
echo "  complaint accepted: $TKT_ID（自动合规事件 + adv-chen 停新）"

# 佣金结算批次（双人复核 → 审批 → 线下支付登记）
STL_ID=$(curl -s "${V[@]}" -X POST "$BASE/admin/commissions/settlement-batches" -d '{}' | j "['id']")
curl -s "${V[@]}" -H "x-tip-user:rev-a" -X POST "$BASE/admin/commissions/settlement-batches/$STL_ID/review" -d '{}' >/dev/null
curl -s "${V[@]}" -H "x-tip-user:rev-b" -X POST "$BASE/admin/commissions/settlement-batches/$STL_ID/review" -d '{}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/commissions/settlement-batches/$STL_ID/approve" -d '{}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/commissions/settlement-batches/$STL_ID/pay" -d '{"voucherRef":"L3://commission-pay.pdf"}' >/dev/null
echo "  settlement paid: $STL_ID（佣金六态走完）"

# 退款（业务+财务双人 → 登记执行 → 收据冲红）
RFD_ID=$(curl -s "${V[@]}" -X POST "$BASE/admin/commissions/refunds" -d '{
  "orderId":"ORD-0001","lines":[{"amountMinor":"500000","currency":"CNY","reason":"未发生阶段服务费按实退还"}]
}' | j "['id']")
curl -s "${V[@]}" -X POST "$BASE/admin/commissions/refunds/$RFD_ID/review" -d '{"role":"business"}' >/dev/null
curl -s "${V[@]}" -H "x-tip-user:fin-1" -X POST "$BASE/admin/commissions/refunds/$RFD_ID/review" -d '{"role":"finance"}' >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/commissions/refunds/$RFD_ID/execute" -d '{"voucherRef":"L3://refund.pdf"}' >/dev/null
echo "  refund executed: $RFD_ID（双人 + 冲红留痕）"

# ============ M5：邀请、注销 ============
curl -s "${V[@]}" -X POST "$BASE/admin/invites" -d '{"purpose":"customer","email":"guest@example.com"}' >/dev/null
echo "  invite created（邀请灰度门）"
curl -s -H "content-type: application/json" -H "x-tip-realm:customer" -H "x-tip-user:c-3000" -X POST \
  "$BASE/v1/account/deletion" -d '{"reason":"不再需要服务"}' >/dev/null
echo "  deletion cooling（15 天冷静期）"

# ============ AI 初步：知识条目四眼 + 客户授权与问答（运营指标演示） ============
KN=$(curl -s "${A[@]}" -X POST "$BASE/admin/ai-knowledge/ingest" -d '{
  "title":"识别“包成功、不成功全退”话术（示例）",
  "kind":"education",
  "sourceRef":"EDU-2026-001",
  "level":"co",
  "body":"任何承诺获批结果的说法都违规；进度以官方/已核验记录为准。"
}')
KN_ID=$(echo "$KN" | j "['id']")
curl -s "${A[@]}" -X POST "$BASE/admin/ai-knowledge/$KN_ID/submit" >/dev/null
curl -s "${V[@]}" -X POST "$BASE/admin/ai-knowledge/$KN_ID/review" -d '{"decision":"approve"}' >/dev/null
echo "  knowledge published: $KN_ID（四眼）"
curl -s "${C[@]}" -X POST "$BASE/v1/ai/consent" -d '{"granted":true}' >/dev/null
curl -s "${C[@]}" -X POST "$BASE/v1/ai/ask" -d '{"message":"我的案件到哪一步了"}' >/dev/null
curl -s "${C[@]}" -X POST "$BASE/v1/ai/ask" -d '{"message":"我还有哪些费用"}' >/dev/null
echo "  ai metrics seeded（客户授权 + 2 次 grounded 问答）"

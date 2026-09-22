#!/usr/bin/env bash
# 开发环境演示数据种子（仅 dev/test；生产 seed 必须为空，M5-11 有发布扫描断言）
# 用法：先启动 api（默认 http://localhost:3100），再运行本脚本
# 数据全部为虚构【示例】，用于后台页面走查，不代表真实项目/机构/政策。
set -uo pipefail
BASE="${BASE:-http://localhost:3100}"
A=(-H "content-type: application/json" -H "x-tip-realm: staff" -H "x-tip-user: s-author")
V=(-H "content-type: application/json" -H "x-tip-realm: staff" -H "x-tip-user: s-verifier")
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }

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
echo "== dev seed 完成（重跑会因唯一编码报错属正常，内存仓储重启即清空）"

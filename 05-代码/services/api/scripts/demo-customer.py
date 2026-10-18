# -*- coding: utf-8 -*-
"""真实产品演示客户（1 个）：adv-chen × c-1980 × 安提瓜 NDF 真实项目。

依赖：real-seed 已完成（实体 ENT-0001、项目 PROJ-ATG-NDF、费表 FEE-ATG-NDF 均已发布）。
流程：顾问入驻→项目授权→客户咨询→方案四眼→订单（主体门/合同/生效）→建案材料清单。
全程幂等容错：重复创建（409/400/422）视为已存在并继续。
用法：python3 demo-customer.py [BASE]
"""
import json, sys, time, datetime
import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
PROJ = "PROJ-ATG-NDF"
ENT_ID = "ENT-0001"
ADV = "adv-chen"
CUS = "c-1980"

A = {"x-tip-realm": "staff", "x-tip-user": "admin01", "content-type": "application/json"}
V = {"x-tip-realm": "staff", "x-tip-user": "reviewer1", "content-type": "application/json"}
CHEN = {"x-tip-realm": "staff", "x-tip-user": ADV, "content-type": "application/json"}
C1 = {"x-tip-realm": "customer", "x-tip-user": CUS, "content-type": "application/json"}


def call(method, path, headers=None, body=None, tries=8):
    for i in range(tries):
        try:
            r = requests.request(method, BASE + path, headers=headers or A, json=body, timeout=120)
            if r.status_code >= 500:
                time.sleep(3 + i * 3); continue
            try:
                data = r.json()
            except Exception:
                data = {"raw": r.text}
            return r.status_code, data
        except (requests.ConnectionError, requests.Timeout):
            time.sleep(4 + i * 4)
    raise RuntimeError(f"FAIL {method} {path}")


def ok(label, method, path, headers=None, body=None, want=None):
    sc, d = call(method, path, headers, body)
    good = (sc < 400) or (isinstance(d, dict) and d.get("code") in (
        "40901", "40902", "40903", "44401", "44301", "409"))
    print(f"  {'✓' if good else '✗'} {label} [{sc}] {'' if good else str(d)[:200]}")
    return d if isinstance(d, dict) else {}


def main():
    print(f"BASE={BASE}  演示客户 {CUS} × {ADV} × {PROJ}（安提瓜 NDF）")

    # 1) 顾问入驻（四眼）
    ob = ok("顾问入驻草稿", "POST", "/advisor/onboarding/drafts", CHEN, {
        "phone": "13800010001", "entityId": ENT_ID, "realName": "陈顾问（演示）",
        "materialRefs": ["l3://id-card", "l3://cert"],
        "selfIntro": "【演示】专注加勒比投资入籍，费用分项透明、节点可追溯。",
        "title": "资深顾问", "yearsOfPractice": 6, "filingNo": "DEMO-备案编号待补录"})
    ob_id = ob.get("id") or ADV
    for k in ["no_private_collection", "no_offplatform_promise", "no_exaggeration", "confidentiality"]:
        ok(f"承诺 {k}", "POST", f"/advisor/onboarding/{ob_id}/commitment", CHEN, {"key": k})
    ok("培训完成", "POST", f"/advisor/onboarding/{ob_id}/training", CHEN)
    ok("入驻提交", "POST", f"/advisor/onboarding/{ob_id}/submit", CHEN)
    ok("入驻批准", "POST", f"/admin/advisors/{ob_id}/approve", V)

    # 2) 项目授权（顾问学习材料 → 申请 → 平台批准）
    ok("授权开始", "POST", f"/advisor/grants/{PROJ}/start", CHEN)
    for m in ["project_rules", "banned_words", "fee_script"]:
        ok(f"学习确认 {m}", "POST", f"/advisor/grants/{PROJ}/confirm", CHEN, {"materialKey": m})
    ok("授权申请提交", "POST", f"/advisor/grants/{PROJ}/submit", CHEN, {"requestedDays": 500})
    ok("授权批准", "POST", f"/admin/advisors/grants/{ADV}/{PROJ}/approve", V)

    # 3) 客户咨询（名片直连）→ 顾问接单
    r = ok("客户发起咨询", "POST", "/v1/engagements/capture", C1, {
        "source": "card_request", "advisorId": ADV, "projectCode": PROJ,
        "note": "【演示】希望了解安提瓜 NDF 捐款路径的单人费用与周期。"})
    rid = (r.get("consultation") or {}).get("id")
    if rid:
        ok("顾问接单", "POST", f"/advisor/engagements/{rid}/accept", CHEN)

    # 4) 方案（四眼：顾问提交→平台批准→客户确认）
    prop = ok("方案草稿", "POST", "/advisor/proposals/drafts", CHEN, {
        "customerRef": CUS, "projectCode": PROJ,
        "advice": [
            {"text": "安提瓜 NDF 路径单人官方捐款 23 万美元，另有政府申请费、尽职调查费与持牌律师费等分项；家庭按人数与年龄另计。", "sourceRef": f"{PROJ}@v1#fee"},
            {"text": "资料经持牌律师与 CIU 两道尽调，官方审核以当局为准；本平台不承诺获批结果，仅对材料与流程负责。", "sourceRef": f"{PROJ}@v1#process"},
        ],
        "responsibilities": "【演示】平台负责费用分项透明、材料清单、进度提醒与受控登记；官方费以递交时费表为准。",
        "nonCommitments": ["不承诺获批结果", "官方费以递交时为准", "第三方费用按实际发生"]})
    pid = prop.get("id")
    if pid:
        ok("方案提交", "POST", f"/advisor/proposals/{pid}/submit", CHEN)
        ok("方案批准", "POST", f"/admin/proposals/{pid}/approve", V)
        ok("客户确认方案", "POST", f"/v1/proposals/{pid}/confirm", C1)

    # 5) 订单三要素（真实主体，账号演示占位）
    ok("订单三要素配置", "PUT", "/admin/orders/config", V, {
        "overseasParty": {"linked": True, "name": "安提瓜持牌律师（交付合作方，演示）", "licensed": True},
        "payeeAccounts": [{"name": "北京赛哲桥国际咨询有限公司", "bank": "中国银行北京分行（演示待补录）", "account": "DEMO-待补录"}]})
    orders = call("GET", "/admin/orders", V)[1].get("records", [])
    oid = orders[0]["id"] if orders else None
    if oid:
        ok("主体门通过", "POST", f"/admin/orders/{oid}/subject-check", V)
        tpl = ok("合同模板草稿", "POST", "/admin/contract-templates/drafts", V, {"title": "赛哲桥·投资入籍服务合同（演示）"})
        tid = tpl.get("id")
        if tid:
            ok("合同五要素", "POST", f"/admin/contract-templates/{tid}/update", V,
               {"scope": True, "refund": True, "overseasNotice": True, "guarantee": True, "privacy": True})
            ok("合同模板发布", "POST", f"/admin/contract-templates/{tid}/publish", V)
            ok("发起签署", "POST", f"/admin/orders/{oid}/signing/start", V, {"templateId": tid})
        for k in ["fees", "non_commitment", "privacy"]:
            ok(f"客户授权 {k}", "POST", f"/v1/orders/{oid}/consents", C1, {"key": k})
        ok("合同登记", "POST", f"/admin/orders/{oid}/contract/register", V, {
            "signedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "artifactRef": f"l3://signed/demo-{oid}.pdf", "registrarId": "reviewer1"})
        ok("订单生效", "POST", f"/admin/orders/{oid}/make-effective", V)

        # 6) 首付：签约期「平台服务费」due 分期 → 客户上传凭证 → 财务双人核验 → 开收据
        _, plan = call("GET", f"/v1/orders/{oid}/payment-plan", C1)
        due = next((i for i in plan.get("installments", [])
                    if i.get("status") == "due" and i.get("feeCode") == "platform_service"), None)
        if due and due.get("paymentState") != "verified":
            ok("客户上传首付凭证（演示）", "POST", f"/v1/orders/{oid}/payment-vouchers", C1, {
                "installmentSeq": due["seq"], "fileHash": "demo-voucher-0001",
                "artifactRef": "l3://demo/voucher-platform-fee.jpg",
                "amountMinor": due["amountMinor"], "currency": due["currency"]})
            ok("财务双人核验开收据", "POST", f"/admin/payments/{oid}/verify", V, {
                "installmentSeq": due["seq"], "decision": "verified", "secondVerifierId": "admin01"})
        # 7) 建案（部分产品首笔大额为原则性批准后才到期，未到建案条件属真实业务态，容错）
        case = ok("订单建案", "POST", "/admin/cases/from-order", V, {"orderId": oid})
        case_id = case.get("id")
        if case_id:
            ok("生成材料清单", "POST", "/admin/materials/checklist", V, {"caseId": case_id})
            ok("客户上传护照（演示）", "POST", "/v1/materials/upload", C1, {
                "caseId": case_id, "personRef": CUS, "itemCode": "passport",
                "fileHash": "demo-hash-0001", "artifactRef": "l3://demo/passport.jpg",
                "mime": "image/jpeg", "sizeBytes": 102400})
            mats = call("GET", f"/admin/materials?caseId={case_id}", V)[1].get("records", [])
            if mats:
                ok("材料审核通过", "POST", f"/admin/materials/{mats[0]['id']}/review", V, {"decision": "approve"})
        print(f"\n演示客户就绪：订单 {oid}，案件 {case_id or '（首付平台费已核验，待大额政府费节点建案）'}")
    else:
        print("\n未找到订单（方案确认后应自动生成）")

    print("完成。")


if __name__ == "__main__":
    main()

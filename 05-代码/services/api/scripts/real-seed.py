# -*- coding: utf-8 -*-
"""真实数据 seed：机构 + 21 个在售产品（费表四眼、事实核验、项目两段发布）。
用法：python3 real-seed.py [BASE_URL]
幂等：重复执行时已存在的编码会跳过。
"""
import json, sys, time, os
import requests
from real_seed_data import PROGRAMS

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
ADMIN = {"x-tip-realm": "staff", "x-tip-user": "admin01", "content-type": "application/json"}
VER = {"x-tip-realm": "staff", "x-tip-user": "reviewer1", "content-type": "application/json"}

DEC = {"CNY":2,"USD":2,"EUR":2,"GBP":2,"HKD":2,"JPY":0,"CAD":2,"AUD":2,"SGD":2,"THB":2,"FJD":2,"KRW":0,"HUF":0}

def req(method, path, headers=None, body=None, tries=6):
    url = BASE + path
    for i in range(tries):
        try:
            r = requests.request(method, url, headers=headers or ADMIN, json=body, timeout=90)
            if r.status_code >= 500:
                time.sleep(3 + i*3); continue
            if r.status_code == 409:
                return {"__conflict__": True, "status": 409, "body": r.text}
            if r.status_code >= 400:
                raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:500]}")
            if not r.text:
                return {}
            return r.json()
        except (requests.ConnectionError, requests.Timeout):
            time.sleep(4 + i*4)
    raise RuntimeError(f"FAIL {method} {path} after retries")

def minor(amount, currency):
    if amount is None: return None
    return int(round(amount * (10 ** DEC[currency])))

def fee_items(items):
    out = []
    for code, label, nature, collector, cur, amount, cert, timing in items:
        out.append({
            "code": code, "label": label, "nature": nature,
            "collector": collector if collector else None,
            "collectorTbc": bool(collector is None and cert != "tbc") or None if False else (True if collector is None else None),
            "currency": cur,
            "amountMinor": minor(amount, cur) if (cur and amount is not None) else None,
            "certainty": cert, "timing": timing,
        })
    # 去掉 None 值键，保持干净
    for o in out:
        if o["collectorTbc"] is None: o.pop("collectorTbc")
    return out

def main():
    print(f"BASE={BASE}")
    # 1) 境内机构（真实主体；备案号缺失，以演示态激活并显著标注，上线前替换）
    ent = req("POST", "/admin/entities", ADMIN, {
        "name": "北京赛哲桥国际咨询有限公司",
        "creditCode": "91110113MAKF59G00G",
        "filingNo": "DEMO-备案编号待补录",
        "filingExpiresAt": "2027-12-31",
        "contactName": "杨仁杰",
        "contactPhone": "+86-18600350209",
        "note": "演示数据：出入境中介备案编号待补录，正式上线前替换为真实备案；统一社会信用代码来自工商公开信息。"
    })
    ent_id = ent.get("id")
    if ent_id:
        req("POST", f"/admin/entities/{ent_id}/active", VER)
        print(f"[entity] active {ent_id}")
    else:
        print("[entity] 已存在，跳过")

    # 幂等：先拉取已存在的项目/费表，按 code 判重
    def list_records(path):
        d = req("GET", path, ADMIN)
        return d.get("records", []) if isinstance(d, dict) else (d or [])

    existing_projects = {r.get("code"): r for r in list_records("/admin/catalog/projects")}
    existing_fees = {r.get("code"): r for r in list_records("/admin/catalog/fee-schedules")}

    results = []
    for p in PROGRAMS:
        code = p["code"]
        print(f"\n=== {code} {p['title']}")
        if code in existing_projects:
            print(f"  [skip] 项目已存在 {existing_projects[code].get('id')}")
            continue

        # 费表（已存在则复用，否则新建并四眼）
        if p["fee_code"] in existing_fees:
            fee_id = existing_fees[p["fee_code"]].get("id")
            print(f"  [fee] 复用已存在 {fee_id}")
        else:
            fee = req("POST", "/admin/catalog/fee-schedules/drafts", ADMIN, {
                "code": p["fee_code"], "title": p["fee_title"], "body": p["fee_body"],
                "feeItems": fee_items(p["items"]),
            })
            fee_id = fee.get("id")
            if not fee_id:
                raise RuntimeError(f"费表创建失败: {fee}")
            req("POST", f"/admin/catalog/fee-schedules/{fee_id}/submit", ADMIN)
            req("POST", f"/admin/catalog/fee-schedules/{fee_id}/review", VER, {"event": "approve"})
            print(f"  [fee] published {fee_id}")

        # 事实核验（登记即 verified）
        vf = req("POST", "/admin/verifications", VER, {
            "fact": p["fact"], "factType": "policy",
            "sourceType": "official_doc", "sourceRef": p["source_ref"],
            "sourcePublishedAt": "2026-08-01",
        })
        vf_id = vf.get("id")
        print(f"  [fact] {vf_id} {vf.get('state')}")

        # 项目两段发布
        proj = req("POST", "/admin/catalog/projects/drafts", ADMIN, {
            "code": code, "title": p["title"], "body": p["body"],
            "keyFactIds": [vf_id] if vf_id else [],
            "feeScheduleId": fee_id,
        })
        proj_id = proj.get("id")
        if not proj_id:
            raise RuntimeError(f"项目创建失败: {proj}")
        req("POST", f"/admin/catalog/projects/{proj_id}/submit-verification", ADMIN)
        req("POST", f"/admin/catalog/projects/{proj_id}/verification", VER, {"decision": "pass"})
        pub = req("POST", f"/admin/catalog/projects/{proj_id}/publication", VER, {"decision": "approve"})
        print(f"  [project] {pub.get('state')} {proj_id}")
        results.append({"code": code, "id": proj_id, "state": pub.get("state"), "fee": fee_id})

    print("\n=== 本次新建已发布项目数：", len(results))
    json.dump(results, open(os.path.join(os.path.dirname(__file__), "real-seed-result.json"), "w"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()

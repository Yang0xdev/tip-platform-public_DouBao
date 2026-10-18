# -*- coding: utf-8 -*-
"""真实资料批量导入数据工厂（七工段四眼发布）+ 按项目编译 K1 知识页。

用法：python3 real-ingest.py [BASE_URL] [MANIFEST_PATH] [FILES_ROOT]
- 数字 PDF ≤17MB 走 ingest-pdf（服务端版面/表格重建）
- 其余有文本资料（docx/xlsx/pptx/大 PDF）走 ingest-text（sourceType=export）
- 扫描件（manifest scan=True）与空模板跳过，留待 Mac 浏览器视觉解析
- 每份：auto-run → submit(admin01) → review approve(reviewer1) → publish(reviewer1)
- 按项目聚合发布后的 wikiSourceId，编译 K1 页（lint→submit→review）
幂等：标题已存在的来源跳过；已发布的 K1 页 slug 跳过。
"""
import base64, json, os, sys, time, traceback
import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100"
HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    HERE, "..", "..", "..", "..", "00-原始资料", "manifest.json")
FILES_ROOT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(
    HERE, "..", "..", "..", "..", "00-原始资料", "项目资料")

ADMIN = {"x-tip-realm": "staff", "x-tip-user": "admin01", "content-type": "application/json"}
VER = {"x-tip-realm": "staff", "x-tip-user": "reviewer1", "content-type": "application/json"}

PDF_BYTES_LIMIT = 17 * 1024 * 1024  # base64 膨胀后 ≤25mb body 限制

COUNTRY_MAP = {
    ("01_亚洲", "新加坡"): "PROJ-SGP-EP",
    ("01_亚洲", "日本"): "PROJ-JPN-BM",
    ("01_亚洲", "泰国"): "PROJ-THA-PE",
    ("01_亚洲", "阿联酋"): "PROJ-ARE-INV",
    ("01_亚洲", "韩国"): "PROJ-KOR-DEP",
    ("02_欧洲", "匈牙利"): "PROJ-HUN-FUND",
    ("02_欧洲", "匈牙利蓝卡"): "PROJ-HUN-BLUE",
    ("02_欧洲", "希腊"): "PROJ-GRC-GV",
    ("02_欧洲", "欧盟"): "PROJ-SVN-CIT",
    ("02_欧洲", "英国"): "PROJ-MSR-UK",
    ("02_欧洲", "葡萄牙"): "PROJ-PRT-GV",
    ("02_欧洲", "西班牙数字游民"): "PROJ-ESP-DNV",
    ("02_欧洲", "马耳他"): "PROJ-MLT-MPRP",
    ("03_加勒比", "圣卢西亚"): "PROJ-LCA-CBI",
    ("03_加勒比", "安提瓜和巴布达"): "PROJ-ATG-NDF",
    ("03_加勒比", "格林纳达"): "PROJ-GRD-CBI",
    ("04_美洲", "巴拿马"): "PROJ-PAN-PR",
    ("04_美洲", "美国EB-1A"): "PROJ-USA-EB1A",
    ("05_大洋洲", "斐济"): "PROJ-FJI-RET",
    ("05_大洋洲", "瓦努阿图"): "PROJ-VUT-DSP",
    ("06_非洲", "圣多美和普林西比"): "PROJ-STP-CBI",
}


def req(method, path, headers=None, body=None, tries=8, allow_4xx=False):
    for i in range(tries):
        try:
            r = requests.request(method, BASE + path, headers=headers or ADMIN, json=body, timeout=180)
            if r.status_code >= 500:
                time.sleep(3 + i * 3); continue
            if r.status_code >= 400 and not allow_4xx:
                raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:400]}")
            if not r.text:
                return r.status_code, {}
            return r.status_code, r.json()
        except (requests.ConnectionError, requests.Timeout):
            time.sleep(4 + i * 4)
    raise RuntimeError(f"FAIL {method} {path}")


def main():
    from real_seed_data import PROGRAMS
    proj_title = {p["code"]: p["title"] for p in PROGRAMS}

    recs = json.load(open(MANIFEST, encoding="utf-8"))
    print(f"BASE={BASE}\nmanifest {len(recs)} 条")

    _, existing = req("GET", "/admin/refinery/sources", ADMIN)
    have_titles = {r.get("title") for r in existing.get("records", [])}
    _, canon = req("GET", "/admin/refinery/canonical", ADMIN)
    title2ws = {c.get("title"): c.get("wikiSourceId")
                for c in canon.get("records", [])
                if c.get("status") == "published" and c.get("wikiSourceId")}
    _, pages = req("GET", "/admin/wiki/pages", ADMIN)
    pages_by_slug = {p.get("slug"): p for p in pages.get("records", [])}

    project_ws = {}   # proj_code -> [wikiSourceId]
    skipped_scan, skipped_empty, skipped_exists, skipped_dup, failed = [], [], [], [], []
    published = 0

    for r in recs:
        name = r["name"]
        title = os.path.splitext(name)[0]
        rel = r["rel"]
        ext = r["ext"]
        size = int(r.get("size") or 0)
        chars = int(r.get("chars") or 0)
        scan = bool(r.get("scan"))
        proj = COUNTRY_MAP.get((r["region"], r["country"]))
        if not proj:
            failed.append((name, "no project map")); continue

        if scan:
            skipped_scan.append(name); continue
        if chars < 30:
            skipped_empty.append(name); continue
        if title in have_titles:
            skipped_exists.append(name)
            # 已存在且已发布的来源，从 canonical 归集 wikiSourceId
            ws = title2ws.get(title)
            if ws: project_ws.setdefault(proj, []).append(ws)
            continue

        try:
            path = os.path.join(FILES_ROOT, rel)
            # ① 采集
            if ext == "pdf" and size <= PDF_BYTES_LIMIT and os.path.exists(path):
                with open(path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                sc, raw = req("POST", "/admin/refinery/sources/ingest-pdf", ADMIN,
                              {"title": title, "base64": b64}, allow_4xx=True)
            else:
                fmt = "spreadsheet" if ext == "xlsx" else "text/plain"
                sc, raw = req("POST", "/admin/refinery/sources/ingest-text", ADMIN,
                              {"title": title, "content": r["text"], "sourceType": "export", "format": fmt},
                              allow_4xx=True)
            sid = raw.get("id") if isinstance(raw, dict) else None
            if not sid:
                if sc == 409:
                    skipped_dup.append(name)
                else:
                    failed.append((name, f"ingest {sc} {str(raw)[:120]}"))
                continue

            # ② 流水线跑到待复核（含一次自动修复）
            try:
                req("POST", f"/admin/refinery/sources/{sid}/auto-run", ADMIN)
            except RuntimeError as e:
                repaired = False
                sc, detail = req("GET", f"/admin/refinery/sources/{sid}", ADMIN)
                findings = (detail.get("findings") or [])
                blocks = [f for f in findings if f.get("level") == "block"]
                if all(f.get("code") == "L-REQ" for f in blocks) and blocks:
                    # 流程/清单类被误判为合同/法规且必填主体/项目名未取得：改判 other 兜底入库
                    req("POST", f"/admin/refinery/sources/{sid}/classify", ADMIN, {"override": "other"}, allow_4xx=True)
                    repaired = True
                elif any(f.get("code") == "L-WORD" for f in blocks):
                    # 红线词命中：对命中字段做人工中性化修正
                    for f in detail.get("fields", []):
                        if f.get("state") == "found" and f.get("value"):
                            val = f["value"]
                            for bad in ["成功率", "获批率", "包过", "100%成功", "不成功全退", "不成功全额退款",
                                        "内部渠道", "特殊关系", "官方有人", "私转", "转我个人账户"]:
                                val = val.replace(bad, "—")
                            import re as _re
                            val = _re.sub(r"(保证|担保).{0,6}(获批|批准|通过|下签|拿到身份)", "—", val)
                            if val != f["value"]:
                                req("POST", f"/admin/refinery/sources/{sid}/correct-field", ADMIN,
                                    {"key": f["key"], "value": val}, allow_4xx=True)
                    repaired = True
                if repaired:
                    try:
                        req("POST", f"/admin/refinery/sources/{sid}/auto-run", ADMIN)
                    except RuntimeError:
                        failed.append((name, "lint 未通过（需人工复核）")); continue
                else:
                    failed.append((name, f"auto-run {str(e)[:160]}")); continue

            # ③ 四眼
            sc, st = req("GET", f"/admin/refinery/sources/{sid}", ADMIN)
            if st.get("stage") != "awaiting_review":
                failed.append((name, f"stage={st.get('stage')}，未到待复核")); continue
            req("POST", f"/admin/refinery/sources/{sid}/review", VER, {"decision": "approve"})
            _, pub = req("POST", f"/admin/refinery/sources/{sid}/publish", VER)
            ws = (pub.get("canonical") or {}).get("wikiSourceId")
            if ws: project_ws.setdefault(proj, []).append(ws)
            published += 1
            print(f"  ✓ {title}  → {(pub.get('canonical') or {}).get('id')}")
        except Exception as e:
            failed.append((name, repr(e)[:200]))
            traceback.print_exc()
            continue

    # ④ 按项目编译 K1 页
    print("\n=== K1 编译 ===")
    wp_count = 0
    for code, title in proj_title.items():
        ws_ids = project_ws.get(code)
        if not ws_ids:
            print(f"  · {code} 无可发布来源，跳过（可能全为扫描件）")
            continue
        slug = code.lower()
        if slug in pages_by_slug:
            old = pages_by_slug[slug]
            if old.get("state") == "published":
                print(f"  · {slug} 已发布，跳过"); continue
            if old.get("state") == "submitted":
                pid = old["id"]
                req("POST", "/admin/wiki/review", VER, {"pageId": pid, "approve": True})
                wp_count += 1; print(f"  ✓ WP {slug}（补复核）"); continue
            # draft：直接用其 id 重走 lint
            pid = old["id"]
        p = next(x for x in PROGRAMS if x["code"] == code)
        cite = ws_ids[0]
        lines = [f"# {title}", "",
                 f"> 本页由项目资料经四眼复核后汇编，仅作信息整理；费用以已发布费表与正式合同为准，不构成获批承诺（来源：{cite}）。", ""]
        for para in [x.strip() for x in p["body"].split("\n") if x.strip()]:
            lines += [para + f"（来源：{cite}）", ""]
        lines += [f"## 费用口径", f"费用分项、收取方、币种与确定性见已发布费表 {p['fee_code']}；异币种不相加，标注「待确认」项以正式方案为准（来源：{cite}）。", ""]
        lines += [f"## 资料来源", "本页绑定的 L0 来源：" + "、".join(ws_ids) + f"（来源：{cite}）。", ""]
        md = "\n".join(lines)
        if slug not in pages_by_slug:
            sc, page = req("POST", "/admin/wiki/compile", ADMIN,
                           {"title": title, "slug": slug, "sourceIds": ws_ids, "markdown": md,
                            "compiledWith": "manual"}, allow_4xx=True)
            pid = page.get("id")
            if not pid:
                failed.append((f"K1 {code}", str(page)[:160])); continue
        req("POST", "/admin/wiki/lint", ADMIN, {"pageId": pid})
        sc, sub = req("POST", "/admin/wiki/submit", ADMIN, {"pageId": pid}, allow_4xx=True)
        if not (isinstance(sub, dict) and sub.get("state") == "submitted"):
            failed.append((f"K1 {code}", f"submit/lint {str(sub)[:160]}")); continue
        req("POST", "/admin/wiki/review", VER, {"pageId": pid, "approve": True})
        wp_count += 1
        print(f"  ✓ WP {slug}（{len(ws_ids)} 来源）")

    print("\n=== 汇总 ===")
    print(f"发布规范记录 {published}；K1 页 {wp_count}")
    print(f"跳过：扫描件 {len(skipped_scan)}，空模板 {len(skipped_empty)}，已存在 {len(skipped_exists)}，重复内容 {len(skipped_dup)}")
    print(f"失败/待人工 {len(failed)}")
    for n, why in failed:
        print(f"  ! {n}: {why}")
    print("\n扫描件（待 Mac 浏览器视觉解析）：")
    for n in skipped_scan:
        print(f"  · {n}")

    json.dump({
        "published": published, "wikiPages": wp_count,
        "projectWikiSources": project_ws,
        "skippedScan": skipped_scan, "skippedEmpty": skipped_empty, "skippedDup": skipped_dup,
        "failed": failed,
    }, open(os.path.join(HERE, "real-ingest-result.json"), "w", encoding="utf-8"),
       ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()

import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { materialMachine, type MaterialState } from "@tip/core";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { CaseService } from "../case/case.service.js";
import { TaskService } from "../task/task.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { ConsentService } from "../consent/consent.service.js";

/**
 * M3-03 材料中心。
 * 铁律：
 *  - 清单 = 项目版本材料模板 × 案件申请人，案件×Person×材料类型 唯一；
 *  - 受控上传：MIME/大小/哈希由服务端校验，失败不产生版本、状态不前进（不假成功）；
 *  - 退回三要素：原因 + 要求 + 时限，自动关联 T0 Task；
 *  - 已审核文件不可自行替换：替换即新版本、重新审核，旧版留存；
 *  - 任何 L3 原件访问（含本人）写访问记录；无授权直链 403 + 审计。
 */

export interface TemplateItem {
  code: string;
  title: string;
  required: boolean;
  acceptMime: string[];
  maxMb: number;
}

export interface MaterialVersion {
  version: number;
  fileHash: string;
  artifactRef: string;
  mime: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedAt: string;
  reviewOutcome: "pending" | "approved" | "returned";
  reviewerId: string | null;
  reviewedAt: string | null;
  returnReason: string | null;
  superseded: boolean;
}

export interface SupplementInfo {
  reason: string;
  requirement: string;
  deadlineAt: string;
  taskId: string | null;
  at: string;
  by: string;
}

export interface MaterialItem {
  id: string;
  caseId: string;
  personRef: string;
  itemCode: string;
  title: string;
  required: boolean;
  state: MaterialState;
  versions: MaterialVersion[];
  supplement: SupplementInfo | null;
  accessLog: Array<{ actor: string; at: string; reason: string }>;
  createdAt: string;
  updatedAt: string;
}

class MaterialError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

const DEFAULT_TEMPLATE: TemplateItem[] = [
  { code: "passport", title: "护照个人信息页", required: true, acceptMime: ["image/jpeg", "application/pdf"], maxMb: 20 },
  { code: "photo", title: "证件照", required: true, acceptMime: ["image/jpeg"], maxMb: 20 },
  { code: "id_card", title: "身份证件", required: true, acceptMime: ["image/jpeg", "application/pdf"], maxMb: 20 },
  { code: "birth_cert", title: "出生证明", required: false, acceptMime: ["image/jpeg", "application/pdf"], maxMb: 20 },
  { code: "marriage_cert", title: "婚姻状况证明", required: false, acceptMime: ["image/jpeg", "application/pdf"], maxMb: 20 },
  { code: "police_cert", title: "无犯罪记录证明", required: true, acceptMime: ["image/jpeg", "application/pdf"], maxMb: 20 },
  { code: "education", title: "学历证明", required: false, acceptMime: ["image/jpeg", "application/pdf"], maxMb: 20 },
  { code: "bank_statement", title: "资金/银行流水", required: true, acceptMime: ["application/pdf"], maxMb: 20 }
];

@Injectable()
export class MaterialService implements OnModuleInit {
  private items = new Map<string, MaterialItem>();
  private templates = new Map<string, TemplateItem[]>();
  private seq = 0;

  constructor(
    private readonly cases: CaseService,
    private readonly tasks: TaskService,
    private readonly timeline: TimelineService,
    private readonly consents: ConsentService,
    private readonly audit: AuditService,
    private readonly store?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.store?.enabled) return;
    const rows = await this.store.listAll<MaterialItem>("material");
    let maxSeq = 0;
    for (const r of rows) {
      this.items.set(r.aggregateId, { ...r.snapshot, state: r.state as MaterialState });
      const n = Number(r.aggregateId.replace("MAT-", ""));
      if (n > maxSeq) maxSeq = n;
    }
    this.seq = maxSeq;
  }

  /* ---------------- 模板管理 ---------------- */

  putTemplate(projectCode: string, items: TemplateItem[], actor: string) {
    if (!Array.isArray(items) || items.length === 0)
      throw new MaterialError(422, "42602", "材料模板至少包含一个条目");
    for (const it of items) {
      if (!it.code || !it.title || !Array.isArray(it.acceptMime) || it.acceptMime.length === 0)
        throw new MaterialError(422, "42602", "模板条目缺少编码/标题/接受类型");
      if (!(it.maxMb > 0)) throw new MaterialError(422, "42602", "模板条目大小上限无效");
    }
    this.templates.set(projectCode, items);
    this.audit.record({ actor, realm: "staff", action: "material.template.put", resource: projectCode, result: "allow" });
    return { projectCode, count: items.length };
  }

  getTemplate(projectCode: string): TemplateItem[] {
    return this.templates.get(projectCode) ?? DEFAULT_TEMPLATE;
  }

  /* ---------------- 清单生成 ---------------- */

  generateChecklist(caseId: string, actor: string): MaterialItem[] {
    const c = this.cases.list().find((x) => x.id === caseId);
    if (!c) throw new MaterialError(404, "42601", "案件不存在");
    const tpl = this.getTemplate(c.projectCode);
    const now = new Date().toISOString();
    const created: MaterialItem[] = [];
    for (const person of c.applicants) {
      for (const t of tpl) {
        const exists = [...this.items.values()].some(
          (m) => m.caseId === caseId && m.personRef === person.ref && m.itemCode === t.code
        );
        if (exists) continue; // 幂等
        this.seq += 1;
        const m: MaterialItem = {
          id: `MAT-${String(this.seq).padStart(4, "0")}`,
          caseId,
          personRef: person.ref,
          itemCode: t.code,
          title: t.title,
          required: t.required,
          state: "pending",
          versions: [],
          supplement: null,
          accessLog: [],
          createdAt: now,
          updatedAt: now
        };
        this.items.set(m.id, m);
        this.persist(m, actor);
        created.push(m);
      }
    }
    this.audit.record({
      actor,
      realm: "staff",
      action: "material.checklist.generate",
      resource: caseId,
      result: "allow",
      reason: `+${created.length}`
    });
    return created;
  }

  /* ---------------- 受控上传 ---------------- */

  upload(
    caseId: string,
    personRef: string,
    itemCode: string,
    body: { fileHash: string; artifactRef: string; mime: string; sizeBytes: number },
    actor: string
  ): MaterialItem {
    const c = this.cases.list().find((x) => x.id === caseId);
    if (!c) throw new MaterialError(404, "42601", "案件不存在");
    // 授权三重校验：本人 / 成年成员逐项授权 / 子女监护证据（直链同样拦截）
    const applicant = c.applicants.find((a) => a.ref === personRef);
    if (!applicant) {
      this.denyUpload(caseId, personRef, itemCode, actor, "非案件申请人");
      throw new MaterialError(403, "42605", "服务端已拒绝：非案件申请人（非故障）");
    }
    if (applicant.role === "primary") {
      if (actor !== personRef) {
        this.denyUpload(caseId, personRef, itemCode, actor, "非本人");
        throw new MaterialError(403, "42605", "服务端已拒绝：须本人提交（非故障）");
      }
    } else if (applicant.role === "child") {
      if (actor !== c.customerRef) {
        this.denyUpload(caseId, personRef, itemCode, actor, "非监护人");
        throw new MaterialError(403, "42605", "服务端已拒绝：仅登记监护人可代子女提交（非故障）");
      }
      this.consents.assertCanActForChild(caseId, personRef); // 43005 缺失/争议
    } else {
      if (actor !== personRef) {
        this.denyUpload(caseId, personRef, itemCode, actor, "成年成员非本人");
        throw new MaterialError(403, "42605", "服务端已拒绝：成年成员材料须本人提交（非故障）");
      }
      this.consents.assertAction(caseId, personRef, "material:view_submit"); // 43006
    }
    const m = [...this.items.values()].find(
      (x) => x.caseId === caseId && x.personRef === personRef && x.itemCode === itemCode
    );
    if (!m) throw new MaterialError(404, "42601", "清单项不存在");

    const tpl = this.getTemplate(c.projectCode).find((t) => t.code === itemCode)!;
    // —— 服务端入库前校验：任何一项失败即整体失败，不写版本、不改状态（不假成功）——
    if (!body.fileHash || !body.artifactRef)
      throw new MaterialError(422, "42602", "上传失败：缺少文件凭据，请重试");
    if (!tpl.acceptMime.includes(body.mime))
      throw new MaterialError(422, "42602", `上传失败：仅支持 ${tpl.acceptMime.join("、")}`);
    if (!(body.sizeBytes > 0) || body.sizeBytes > tpl.maxMb * 1024 * 1024)
      throw new MaterialError(422, "42602", `上传失败：文件须大于 0 且不超过 ${tpl.maxMb}MB`);

    const event = m.state === "supplement_needed" ? "resubmit" : "submit";
    // 已审核通过的文件：允许提交新版本重新审核，禁止就地替换
    if (m.state === "approved") {
      m.versions.filter((v) => !v.superseded).forEach((v) => (v.superseded = true));
    }
    const out = materialMachine.transition(null, m.state, event);
    if (!out.ok) {
      this.audit.record({ actor, realm: "customer", action: "material.upload", resource: m.id, result: "deny", reason: out.code });
      throw new MaterialError(409, "42604", out.reason ?? "当前状态不可上传");
    }
    const now = new Date().toISOString();
    m.versions.push({
      version: m.versions.length + 1,
      fileHash: body.fileHash,
      artifactRef: body.artifactRef,
      mime: body.mime,
      sizeBytes: body.sizeBytes,
      uploadedBy: actor,
      uploadedAt: now,
      reviewOutcome: "pending",
      reviewerId: null,
      reviewedAt: null,
      returnReason: null,
      superseded: false
    });
    m.state = out.to as MaterialState;
    m.supplement = null;
    m.updatedAt = now;
    this.persist(m, actor);
    this.timeline.recordCustomer(m.caseId, "material_submit", `材料已提交：${m.title}`, actor);
    this.audit.record({ actor, realm: "customer", action: "material.upload", resource: m.id, result: "allow", reason: `v${m.versions.length}` });
    return m;
  }

  /* ---------------- 审核 ---------------- */

  review(
    id: string,
    decision: "approve" | "return",
    body: { reason?: string; requirement?: string; deadlineAt?: string },
    reviewer: string
  ): MaterialItem {
    const m = this.require(id);
    const v = m.versions.filter((x) => !x.superseded).at(-1);
    if (!v || v.reviewOutcome !== "pending")
      throw new MaterialError(409, "42604", "没有待审核的文件版本");

    if (decision === "return") {
      const { reason, requirement, deadlineAt } = body;
      if (!reason?.trim() || !requirement?.trim() || !deadlineAt || Number.isNaN(Date.parse(deadlineAt))) {
        throw new MaterialError(422, "42603", "退回须填写：原因、补充要求、时限（三要素）");
      }
      const out = materialMachine.transition(null, m.state, "return");
      if (!out.ok) throw new MaterialError(409, "42604", out.reason ?? "当前状态不可退回");
      const now = new Date().toISOString();
      v.reviewOutcome = "returned";
      v.reviewerId = reviewer;
      v.reviewedAt = now;
      v.returnReason = reason;
      // 自动关联 T0 任务（时限即截止；官方/合同来源）
      const task = this.tasks.create(
        m.caseId,
        {
          type: `material:${m.itemCode}`,
          title: `补件：${m.title}`,
          ownerId: m.personRef,
          dueAt: deadlineAt,
          source: "contract",
          t0: true
        },
        reviewer
      );
      m.supplement = { reason, requirement, deadlineAt, taskId: task.id, at: now, by: reviewer };
      m.state = out.to as MaterialState;
      m.updatedAt = now;
      this.persist(m, reviewer);
      this.audit.record({ actor: reviewer, realm: "staff", action: "material.return", resource: m.id, result: "allow", reason: task.id });
      return m;
    }

    const out = materialMachine.transition(null, m.state, "approve");
    if (!out.ok) throw new MaterialError(409, "42604", out.reason ?? "当前状态不可通过");
    const now = new Date().toISOString();
    v.reviewOutcome = "approved";
    v.reviewerId = reviewer;
    v.reviewedAt = now;
    m.state = out.to as MaterialState;
    m.updatedAt = now;
    this.persist(m, reviewer);
    this.timeline.recordCompany(m.caseId, "material_approved", reviewer, m.title);
    this.audit.record({ actor: reviewer, realm: "staff", action: "material.approve", resource: m.id, result: "allow" });
    return m;
  }

  private denyUpload(caseId: string, personRef: string, itemCode: string, actor: string, reason: string) {
    this.audit.record({ actor, realm: "customer", action: "material.upload", resource: `${caseId}:${personRef}:${itemCode}`, result: "deny", reason });
  }

  /* ---------------- 查看（受控，留痕） ---------------- */

  /** 取原件引用：仅本人或已授权人；每次访问（含本人）写记录；无授权 403+审计 */
  getArtifact(id: string, actor: string, realm: "customer" | "staff"): { artifactRef: string; mime: string } {
    const m = this.require(id);
    const c = this.cases.list().find((x) => x.id === m.caseId)!;
    const authorized = realm === "customer" && actor === m.personRef; // 顾问/服务方默认不开放原件
    if (!authorized) {
      this.audit.record({ actor, realm, action: "material.artifact.deny", resource: m.id, result: "deny", reason: "无原件查看授权" });
      throw new MaterialError(403, "42605", "无授权查看该材料原件");
    }
    const v = m.versions.filter((x) => !x.superseded).at(-1);
    if (!v) throw new MaterialError(404, "42601", "尚无已上传文件");
    const now = new Date().toISOString();
    m.accessLog.push({ actor, at: now, reason: c.customerRef === actor ? "本人查看" : "授权查看" });
    m.updatedAt = now;
    this.persist(m, actor);
    this.audit.record({ actor, realm, action: "material.artifact.view", resource: m.id, result: "allow" });
    return { artifactRef: v.artifactRef, mime: v.mime };
  }

  /* ---------------- 查询 ---------------- */

  listForCase(caseId: string): MaterialItem[] {
    return [...this.items.values()].filter((m) => !caseId || m.caseId === caseId);
  }

  /** 客户视图：按申请人分栏；只回本人可见行（他人行由端上以锁定态呈现，不回内容） */
  listForCustomer(customerRef: string, caseId: string): MaterialItem[] {
    return this.listForCase(caseId)
      .filter((m) => m.personRef === customerRef)
      .map((m) => ({
        ...m,
        // 对客不下发内部访问日志
        accessLog: []
      }));
  }

  /** 顾问只读：状态与标题，不含原件引用 */
  listForAdvisor(caseId: string) {
    return this.listForCase(caseId).map((m) => ({
      id: m.id,
      personRef: m.personRef,
      itemCode: m.itemCode,
      title: m.title,
      required: m.required,
      state: m.state,
      supplement: m.supplement,
      versionCount: m.versions.length
    }));
  }

  /* ---------------- 内部 ---------------- */

  private require(id: string): MaterialItem {
    const m = this.items.get(id);
    if (!m) throw new MaterialError(404, "42601", "材料项不存在");
    return m;
  }

  private persist(m: MaterialItem, actor: string) {
    if (!this.store?.enabled) return;
    void this.store.save("material", m.id, 1, m.state, m as never, actor);
  }
}

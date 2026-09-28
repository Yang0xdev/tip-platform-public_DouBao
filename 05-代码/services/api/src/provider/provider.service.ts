import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { EntityService } from "../entities/entity.service.js";

/**
 * M3-07 供给准入 A02（ext/in 双模式，同一控制点）。
 * 主体类型：domestic_entity 境内主体 / overseas_licensee 境外持牌方 / inhouse_delivery 自营交付部门。
 * 铁律：
 *  - ext：关联境内备案有效主体 + 有效持牌凭据（按国别配置）+ 协议四件齐备，才可提交；
 *  - in（自营交付部门）：同样控制点不豁免；
 *  - 临期/到期：门户停权、停派案、在办交接（状态机驱动）；
 *  - 无有效持牌境外方不可被选为交付方（订单主体门联动 assertUsable）。
 */

export type ProviderType = "domestic_entity" | "overseas_licensee" | "inhouse_delivery";
export type ProviderState =
  | "incomplete"
  | "in_review"
  | "active"
  | "expiring"
  | "suspended"
  | "terminated";

export interface ProviderAgreement {
  framework: boolean;
  dataProcessing: boolean;
  confidentiality: boolean;
  serviceLevel: boolean;
}

export interface LicenseInfo {
  credentialNo: string;
  country: string;
  issuedAt: string;
  expiresAt: string;
  verified: boolean;
  verifierId: string | null;
}

export interface ServiceProvider {
  id: string;
  type: ProviderType;
  mode: "ext" | "in";
  name: string;
  domesticEntityId: string | null;
  license: LicenseInfo | null;
  agreements: ProviderAgreement;
  state: ProviderState;
  submittedAt: string | null;
  submitterId: string | null;
  reviewerId: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

/** 支持的持牌国别配置（初始；影子期按 D2 扩展） */
const SUPPORTED_COUNTRIES = new Set(["CA", "AU", "US", "GB", "PT", "MT", "GR"]);
const EXPIRING_DAYS = 60;

class ProviderError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class ProviderService implements OnModuleInit {
  private providers = new Map<string, ServiceProvider>();
  private seq = 0;

  constructor(
    private readonly entities: EntityService,
    private readonly audit: AuditService,
    private readonly store?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.store?.enabled) return;
    const rows = await this.store.listAll<ServiceProvider>("provider");
    let maxSeq = 0;
    for (const r of rows) {
      this.providers.set(r.aggregateId, { ...r.snapshot, state: r.state as ProviderState });
      const n = Number(r.aggregateId.replace("SP-", ""));
      if (n > maxSeq) maxSeq = n;
    }
    this.seq = maxSeq;
  }

  create(
    body: { type: ProviderType; mode: "ext" | "in"; name: string; domesticEntityId?: string },
    actor: string
  ): ServiceProvider {
    this.seq += 1;
    const now = new Date().toISOString();
    const sp: ServiceProvider = {
      id: `SP-${String(this.seq).padStart(4, "0")}`,
      type: body.type,
      mode: body.mode,
      name: body.name,
      domesticEntityId: body.domesticEntityId ?? null,
      license: null,
      agreements: { framework: false, dataProcessing: false, confidentiality: false, serviceLevel: false },
      state: "incomplete",
      submittedAt: null,
      submitterId: null,
      reviewerId: null,
      reviewedAt: null,
      createdAt: now
    };
    this.providers.set(sp.id, sp);
    this.persist(sp, actor);
    return sp;
  }

  attachLicense(id: string, license: Omit<LicenseInfo, "verified" | "verifierId">, actor: string): ServiceProvider {
    const sp = this.require(id);
    if (!SUPPORTED_COUNTRIES.has(license.country))
      throw new ProviderError(422, "43202", `国别 ${license.country} 暂不在持牌配置内`);
    if (Number.isNaN(Date.parse(license.expiresAt)) || Date.parse(license.expiresAt) <= Date.now())
      throw new ProviderError(422, "43202", "持牌凭据已过期或日期无效");
    sp.license = { ...license, verified: false, verifierId: null };
    this.persist(sp, actor);
    return sp;
  }

  verifyLicense(id: string, verifier: string): ServiceProvider {
    const sp = this.require(id);
    if (!sp.license) throw new ProviderError(422, "43202", "尚无持牌凭据");
    sp.license.verified = true;
    sp.license.verifierId = verifier;
    this.persist(sp, verifier);
    this.audit.record({ actor: verifier, realm: "staff", action: "provider.license.verify", resource: id, result: "allow" });
    return sp;
  }

  setAgreement(id: string, key: keyof ProviderAgreement, actor: string): ServiceProvider {
    const sp = this.require(id);
    sp.agreements[key] = true;
    this.persist(sp, actor);
    return sp;
  }

  linkDomesticEntity(id: string, entityId: string, actor: string): ServiceProvider {
    const sp = this.require(id);
    sp.domesticEntityId = entityId;
    this.persist(sp, actor);
    return sp;
  }

  /** 提交准入：ext/in 同一校验清单，缺件列明（不豁免） */
  submit(id: string, actor: string): ServiceProvider {
    const sp = this.require(id);
    if (sp.state !== "incomplete") throw new ProviderError(409, "43203", "仅未完成档案可提交");
    const missing: string[] = [];

    if (sp.type !== "inhouse_delivery") {
      if (!sp.domesticEntityId) missing.push("关联境内备案主体");
      else {
        const ent = this.entities.list().find((e) => e.id === sp.domesticEntityId);
        if (!ent || !ent.usable) missing.push("境内主体备案无效或已过期");
      }
    }
    if (sp.type !== "domestic_entity") {
      if (!sp.license) missing.push("有效持牌凭据");
      else if (!sp.license.verified) missing.push("持牌凭据待核验");
      else if (Date.parse(sp.license.expiresAt) <= Date.now()) missing.push("持牌凭据已过期");
    }
    const a = sp.agreements;
    if (!a.framework || !a.dataProcessing || !a.confidentiality || !a.serviceLevel)
      missing.push("协议四件齐备（框架/数据处理/保密/服务水平）");

    if (missing.length) throw new ProviderError(422, "43202", `准入缺件：${missing.join("、")}`);
    sp.state = "in_review";
    sp.submittedAt = new Date().toISOString();
    sp.submitterId = actor;
    this.persist(sp, actor);
    this.audit.record({ actor, realm: "staff", action: "provider.submit", resource: id, result: "allow" });
    return sp;
  }

  /** 复核：复核人≠提交人；通过即生效 */
  review(id: string, decision: "active" | "incomplete", actor: string): ServiceProvider {
    const sp = this.require(id);
    if (sp.state !== "in_review") throw new ProviderError(409, "43203", "仅审核中档案可复核");
    if (actor === sp.submitterId)
      throw new ProviderError(409, "43204", "复核人不能是提交人");
    sp.state = decision;
    sp.reviewerId = actor;
    sp.reviewedAt = new Date().toISOString();
    this.persist(sp, actor);
    this.audit.record({ actor, realm: "staff", action: "provider.review", resource: id, result: "allow", reason: decision });
    return sp;
  }

  suspend(id: string, reason: string, actor: string): ServiceProvider {
    const sp = this.require(id);
    sp.state = "suspended";
    this.persist(sp, actor);
    this.audit.record({ actor, realm: "staff", action: "provider.suspend", resource: id, result: "allow", reason });
    return sp;
  }

  terminate(id: string, reason: string, actor: string): ServiceProvider {
    const sp = this.require(id);
    sp.state = "terminated";
    this.persist(sp, actor);
    this.audit.record({ actor, realm: "staff", action: "provider.terminate", resource: id, result: "allow", reason });
    return sp;
  }

  /** 时钟：临期 expiring；过期 suspended（门户/派案由各域读状态执行） */
  tick(nowIso: string): string[] {
    const hit: string[] = [];
    for (const sp of this.providers.values()) {
      if (!sp.license) continue;
      const ms = Date.parse(sp.license.expiresAt) - Date.parse(nowIso);
      if (ms <= 0 && (sp.state === "active" || sp.state === "expiring")) {
        sp.state = "suspended";
        this.persist(sp, "system");
        hit.push(sp.id);
      } else if (ms <= EXPIRING_DAYS * 86_400_000 && sp.state === "active") {
        sp.state = "expiring";
        this.persist(sp, "system");
        hit.push(sp.id);
      }
    }
    return hit;
  }

  /* ---------------- 执行点 / 查询 ---------------- */

  /** 交付方可用性门（订单主体门调用） */
  assertUsable(id: string): ServiceProvider {
    const sp = this.providers.get(id);
    if (!sp) throw new ProviderError(404, "43201", "服务方不存在");
    if (sp.state !== "active" && sp.state !== "expiring")
      throw new ProviderError(403, "43205", `服务方状态 ${sp.state}，不可被选为交付方`);
    if (sp.license && Date.parse(sp.license.expiresAt) <= Date.now())
      throw new ProviderError(403, "43205", "持牌凭据已过期，不可被选为交付方");
    return sp;
  }

  /** 有效境外交付方（持牌或自营）：供订单主体门 */
  findUsableOverseas(): ServiceProvider | undefined {
    return [...this.providers.values()].filter(
      (sp) => (sp.type === "overseas_licensee" || sp.type === "inhouse_delivery")
    ).find((sp) => {
      try { this.assertUsable(sp.id); return true; } catch { return false; }
    });
  }

  list(): ServiceProvider[] {
    return [...this.providers.values()];
  }

  private require(id: string): ServiceProvider {
    const sp = this.providers.get(id);
    if (!sp) throw new ProviderError(404, "43201", "服务方不存在");
    return sp;
  }

  private persist(sp: ServiceProvider, actor: string) {
    if (!this.store?.enabled) return;
    void this.store.save("provider", sp.id, 1, sp.state, sp as never, actor);
  }
}

import { HttpException, Injectable } from "@nestjs/common";

/**
 * 境内机构最小台账（PRD-M1 M1-01，A02 子集）
 * 顾问入驻只能选择"有效/临期"机构；到期后停新（授权不新批、到期不续）。
 * 影子期允许单人编辑但全部写审计；M3 前补齐编辑+复核双人记录。
 */

export type EntityBaseStatus = "pending_filing" | "active" | "suspended" | "terminated";

export interface EntityInput {
  name: string;
  creditCode: string; // 统一社会信用代码
  filingNo?: string | null; // 出入境中介备案编号
  filingExpiresAt?: string | null; // 备案有效期
  contactName?: string | null; // L2
  contactPhone?: string | null;
  note?: string | null;
}

export interface DomesticEntity extends EntityInput {
  id: string;
  baseStatus: EntityBaseStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** 临期提醒阈值（天，初始参数，影子期校准） */
export const DUE_SOON_DAYS = [60, 30, 7];

export class EntityError extends HttpException {
  constructor(status: number, bizCode: string, message: string) {
    super({ code: bizCode, message }, status);
  }
}

@Injectable()
export class EntityService {
  private entities = new Map<string, DomesticEntity>();
  private seq = 0;

  create(input: EntityInput, actor: string): DomesticEntity {
    if (!input.name?.trim() || !input.creditCode?.trim()) {
      throw new EntityError(400, "40020", "机构名称与统一社会信用代码必填");
    }
    for (const e of this.entities.values()) {
      if (e.creditCode === input.creditCode.trim()) throw new EntityError(409, "40920", "统一社会信用代码已存在台账");
    }
    this.seq += 1;
    const now = new Date().toISOString();
    const rec: DomesticEntity = {
      id: `ENT-${String(this.seq).padStart(4, "0")}`,
      ...this.normalize(input),
      baseStatus: "pending_filing",
      createdAt: now,
      updatedAt: now,
      updatedBy: actor
    };
    this.entities.set(rec.id, rec);
    return { ...rec };
  }

  /** 备案完成置有效（备案编号与有效期必填） */
  markActive(id: string, actor: string): DomesticEntity {
    const rec = this.require(id);
    if (!rec.filingNo || !rec.filingExpiresAt) {
      throw new EntityError(422, "42230", "置有效前必须登记备案编号与有效期");
    }
    rec.baseStatus = "active";
    rec.updatedAt = new Date().toISOString();
    rec.updatedBy = actor;
    return { ...rec };
  }

  setStatus(id: string, status: EntityBaseStatus, actor: string): DomesticEntity {
    const rec = this.require(id);
    rec.baseStatus = status;
    rec.updatedAt = new Date().toISOString();
    rec.updatedBy = actor;
    return { ...rec };
  }

  update(id: string, patch: Partial<EntityInput>, actor: string): DomesticEntity {
    const rec = this.require(id);
    Object.assign(rec, this.normalize({ ...rec, ...patch }));
    rec.updatedAt = new Date().toISOString();
    rec.updatedBy = actor;
    return { ...rec };
  }

  list(now = new Date()): Array<DomesticEntity & { displayStatus: string; usable: boolean; daysToExpiry: number | null }> {
    return [...this.entities.values()].map((e) => {
      const days = e.filingExpiresAt ? Math.ceil((new Date(e.filingExpiresAt).getTime() - now.getTime()) / 86_400_000) : null;
      let displayStatus: string = e.baseStatus;
      let usable = false;
      if (e.baseStatus === "active") {
        if (days !== null && days < 0) {
          displayStatus = "terminated"; // 备案到期等同终止，停新
        } else if (days !== null && days <= 60) {
          displayStatus = "due_soon";
          usable = true; // 临期仍可入驻/新签，看板提醒
        } else {
          usable = true;
        }
      }
      return { ...e, displayStatus, usable, daysToExpiry: days };
    });
  }

  /** 顾问入驻/新授权门：仅有效（含临期）机构可用 */
  assertUsable(entityId: string): void {
    const found = this.list().find((e) => e.id === entityId);
    if (!found) throw new EntityError(404, "40420", "机构不存在");
    if (!found.usable) throw new EntityError(422, "42231", `机构当前状态（${found.displayStatus}）不可新增入驻或授权`);
  }

  private require(id: string): DomesticEntity {
    const rec = this.entities.get(id);
    if (!rec) throw new EntityError(404, "40420", "机构不存在");
    return rec;
  }

  private normalize(input: EntityInput): EntityInput {
    return {
      name: input.name?.trim(),
      creditCode: input.creditCode?.trim(),
      filingNo: input.filingNo?.trim() || null,
      filingExpiresAt: input.filingExpiresAt || null,
      contactName: input.contactName?.trim() || null,
      contactPhone: input.contactPhone?.trim() || null,
      note: input.note?.trim() || null
    };
  }
}

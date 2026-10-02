import { HttpException, Injectable } from "@nestjs/common";
import { AuditService } from "../audit.service.js";

/**
 * M5-04/05 数据保留、删除、匿名化与账号注销
 *  - 注销冷静期 15 天（可撤回）；
 *  - 到期不物理清空：财务/审计/合同法定保留记录先匿名化（去标识字段），保留最小台账；
 *  - 主体权利（查阅/更正/删除/携带/撤回同意）走工单，SLA 内响应；
 *  - 进行中订单/未结案件不允许直接注销，先走结清/人工处理。
 */

export type DeletionState = "cooling" | "anonymized" | "cancelled";

export interface DeletionRequest {
  id: string;
  customerRef: string;
  reason: string;
  state: DeletionState;
  requestedAt: string;
  coolingUntil: string;
  anonymizedAt: string | null;
  blockedReason: string | null;
}

const STATUS_BY_CODE: Record<string, number> = {
  "43901": 400,
  "43902": 409,
  "43903": 409,
  "43904": 409,
  "43905": 404
};

export class DeletionError extends HttpException {
  constructor(code: string, message: string) {
    super({ code, message }, STATUS_BY_CODE[code] ?? 400);
  }
}

export const COOLING_DAYS = 15;

@Injectable()
export class DeletionService {
  private requests = new Map<string, DeletionRequest>();
  private seq = 0;

  constructor(private readonly audit: AuditService) {}

  request(
    customerRef: string,
    reason: string,
    hasOpenCaseOrOrder: boolean,
    actor: string
  ): DeletionRequest {
    if (!reason?.trim()) throw new DeletionError("43901", "注销须填写原因");
    if (hasOpenCaseOrOrder)
      throw new DeletionError(
        "43902",
        "存在进行中案件或未结清订单，不可直接注销；请先处理或联系客服"
      );
    if ([...this.requests.values()].some((r) => r.customerRef === customerRef && r.state === "cooling"))
      throw new DeletionError("43903", "已提交注销申请，冷静期内无需重复提交");
    this.seq += 1;
    const now = Date.now();
    const r: DeletionRequest = {
      id: `DEL-${String(this.seq).padStart(4, "0")}`,
      customerRef,
      reason,
      state: "cooling",
      requestedAt: new Date(now).toISOString(),
      coolingUntil: new Date(now + COOLING_DAYS * 864e5).toISOString(),
      anonymizedAt: null,
      blockedReason: null
    };
    this.requests.set(r.id, r);
    this.audit.record({ realm: "customer", action: "deletion.requested", resource: r.id, result: "info", reason, actor });
    return r;
  }

  /** 冷静期撤回 */
  cancel(id: string, actor: string): DeletionRequest {
    const r = this.must(id);
    if (r.state !== "cooling") throw new DeletionError("43904", "仅冷静期内可撤回");
    r.state = "cancelled";
    this.audit.record({ realm: "customer", action: "deletion.cancelled", resource: r.id, result: "info", actor });
    return r;
  }

  /**
   * 时钟：冷静期到期 → 匿名化
   * 匿名化清单由调用方提供（各业务域执行最小化），这里只登记状态。
   */
  tick(nowIso: string, anonymize: (customerRef: string) => void): DeletionRequest[] {
    const out: DeletionRequest[] = [];
    for (const r of this.requests.values()) {
      if (r.state !== "cooling") continue;
      if (Date.parse(nowIso) <= Date.parse(r.coolingUntil)) continue;
      anonymize(r.customerRef);
      r.state = "anonymized";
      r.anonymizedAt = nowIso;
      this.audit.record({ realm: "staff", action: "deletion.anonymized", resource: r.id, result: "allow", actor: "system" });
      out.push(r);
    }
    return out;
  }

  list(): DeletionRequest[] {
    return [...this.requests.values()];
  }
  forCustomer(customerRef: string): DeletionRequest | undefined {
    return [...this.requests.values()].reverse().find((r) => r.customerRef === customerRef);
  }

  private must(id: string): DeletionRequest {
    const r = this.requests.get(id);
    if (!r) throw new DeletionError("43905", "注销申请不存在");
    return r;
  }
}

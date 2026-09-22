import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { RealmAllowed, RealmGuard } from "./realm.guard.js";
import { AuditService } from "./audit.service.js";

/**
 * 审计自检端点（M0）：
 * - /v1/_meta/audit/verify 校验哈希链完整性（M5 起每日自动跑，断链即告警）；
 * - /v1/_meta/audit/tail 查看最近审计记录。
 * 仅员工 realm；客户/门户/匿名访问一律 403/401 并留痕。
 */
@Controller("v1/_meta/audit")
@UseGuards(RealmGuard)
@RealmAllowed("staff", "service")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get("verify")
  verify() {
    return this.audit.verify();
  }

  @Get("tail")
  tail(@Query("limit") limit?: string) {
    const n = Math.min(Number(limit ?? 20) || 20, 100);
    return { records: this.audit.tail(n) };
  }
}

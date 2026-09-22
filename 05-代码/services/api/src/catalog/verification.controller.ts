import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { RealmAllowed, RealmGuard, CurrentActor, type Actor } from "../realm.guard.js";
import { AuditService } from "../audit.service.js";
import { VerificationService, type VerificationInput } from "./verification.service.js";

/** 事实核验台账（M1-03），仅 staff；登记与失效均留痕 */
@Controller("admin/verifications")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class VerificationController {
  constructor(
    private readonly verifications: VerificationService,
    private readonly audit: AuditService
  ) {}

  @Get()
  list() {
    return { records: this.verifications.list() };
  }

  @Post()
  register(@Body() body: VerificationInput, @CurrentActor() actor: Actor) {
    const rec = this.verifications.register(body, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "verification.register", resource: rec.id, result: "allow" });
    return rec;
  }

  @Post(":id/invalidate")
  invalidate(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    const rec = this.verifications.invalidate(id, body.reason);
    this.audit.record({ actor: actor.user, realm: "staff", action: "verification.invalidate", resource: id, result: "allow", reason: body.reason });
    return rec;
  }
}

import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { RealmAllowed, RealmGuard, CurrentActor, type Actor } from "../realm.guard.js";
import { AuditService } from "../audit.service.js";
import { EntityService, type EntityInput, type EntityBaseStatus } from "./entity.service.js";

/** 境内机构台账（M1-01，A02 子集），仅 staff；影子期单人可改但全部留痕 */
@Controller("admin/entities")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class EntityController {
  constructor(
    private readonly entities: EntityService,
    private readonly audit: AuditService
  ) {}

  @Get()
  list() {
    return { records: this.entities.list() };
  }

  @Post()
  create(@Body() body: EntityInput, @CurrentActor() actor: Actor) {
    const rec = this.entities.create(body, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "entity.create", resource: rec.id, result: "allow", subjectRef: rec.name });
    return rec;
  }

  @Post(":id/active")
  markActive(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const rec = this.entities.markActive(id, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "entity.mark_active", resource: id, result: "allow" });
    return rec;
  }

  @Post(":id/status")
  setStatus(@Param("id") id: string, @Body() body: { status: EntityBaseStatus }, @CurrentActor() actor: Actor) {
    const rec = this.entities.setStatus(id, body.status, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "entity.set_status", resource: id, result: "allow", reason: body.status });
    return rec;
  }

  @Post(":id/update")
  update(@Param("id") id: string, @Body() body: Partial<EntityInput>, @CurrentActor() actor: Actor) {
    const rec = this.entities.update(id, body, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "entity.update", resource: id, result: "allow" });
    return rec;
  }
}

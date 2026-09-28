import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { InviteService, type InvitePurpose } from "./invite.service.js";

@Controller("admin/invites")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class InviteAdminController {
  constructor(private readonly invites: InviteService) {}

  @Get()
  list() {
    return { records: this.invites.list() };
  }

  @Post()
  create(
    @Body() body: { purpose: InvitePurpose; email?: string; ttlDays?: number },
    @CurrentActor() actor: Actor
  ) {
    return this.invites.create(body, actor.user);
  }
}

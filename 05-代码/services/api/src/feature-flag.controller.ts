import { Controller, Get, UseGuards } from "@nestjs/common";
import { RealmAllowed, RealmGuard } from "./realm.guard.js";
import { FeatureFlagService } from "./feature-flag.service.js";

/** 特性开关只读端点（M0）：仅员工/服务账号；客户与门户不可见内部门状态。 */
@Controller("v1/_meta/feature-flags")
@UseGuards(RealmGuard)
@RealmAllowed("staff", "service")
export class FeatureFlagController {
  constructor(private readonly flags: FeatureFlagService) {}

  @Get()
  list() {
    return { flags: this.flags.list() };
  }
}

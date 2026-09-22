import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AllowAnonymous, RealmAllowed, RealmGuard } from "../realm.guard.js";
import { CatalogService, toPublicView } from "./catalog.service.js";

/**
 * 对客只读目录（M1-12 游客态 / M1-13 发现与详情）：
 * 仅返回 published；游客可访问，登录客户/员工同样只读；草稿、在审、下架一律不可见。
 */
@Controller("v1/catalog")
@UseGuards(RealmGuard)
@RealmAllowed("staff", "customer", "partner", "service")
@AllowAnonymous()
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("projects")
  listProjects() {
    return { records: this.catalog.listPublished("project").map(toPublicView) };
  }

  @Get("projects/:id")
  project(@Param("id") id: string) {
    return toPublicView(this.catalog.getPublished(id));
  }

  @Get("fee-schedules")
  listFeeSchedules() {
    return { records: this.catalog.listPublished("fee_schedule").map(toPublicView) };
  }

  @Get("fee-schedules/:id")
  feeSchedule(@Param("id") id: string) {
    return toPublicView(this.catalog.getPublished(id));
  }
}

import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AllowAnonymous, RealmAllowed, RealmGuard } from "../realm.guard.js";
import { CatalogService, projectView, feeView } from "./catalog.service.js";

/**
 * 对客只读目录（M1-12 游客态 / M1-13 发现与详情）：
 * 仅返回 published 且核验未失效；游客可读；草稿/在审/暂停/下架一律不可见。
 */
@Controller("v1/catalog")
@UseGuards(RealmGuard)
@RealmAllowed("staff", "customer", "partner", "service")
@AllowAnonymous()
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("projects")
  listProjects() {
    return { records: this.catalog.listPublishedProjects().map(projectView) };
  }

  @Get("projects/:id")
  project(@Param("id") id: string) {
    return projectView(this.catalog.getPublishedProject(id));
  }

  @Get("fee-schedules")
  listFeeSchedules() {
    return { records: this.catalog.listPublishedFees().map(feeView) };
  }

  @Get("fee-schedules/:id")
  feeSchedule(@Param("id") id: string) {
    return feeView(this.catalog.getPublishedFee(id));
  }
}

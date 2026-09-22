import { Controller, Get, UseGuards } from "@nestjs/common";
import { RealmAllowed, RealmGuard } from "../realm.guard.js";
import { QualityService } from "./quality.service.js";

/** 质量基线看板（M1-17，只读，staff） */
@Controller("admin/quality")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  @Get("dashboard")
  dashboard() {
    return this.quality.dashboard();
  }
}

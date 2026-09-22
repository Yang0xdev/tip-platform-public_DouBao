import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AllowAnonymous, CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { AuditService } from "../audit.service.js";
import { DataSourceService, type DataSourceAuthorization } from "./data-source.service.js";

/** 员工侧：数据源授权配置与开关（M1-16，切换必须留痕） */
@Controller("admin/data-sources")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class AdminDataSourceController {
  constructor(
    private readonly sources: DataSourceService,
    private readonly audit: AuditService
  ) {}

  @Get()
  list() {
    return { records: this.sources.list() };
  }

  @Post(":key/configure")
  configure(@Param("key") key: string, @Body() body: Partial<Omit<DataSourceAuthorization, "key" | "note">>, @CurrentActor() actor: Actor) {
    const before = this.sources.list().find((r) => r.key === key);
    const rec = this.sources.configure(key, body);
    if (body.state && before?.state !== body.state) {
      this.audit.record({ actor: actor.user, realm: "staff", action: `data_source.${body.state}`, resource: key, result: "allow" });
    }
    return rec;
  }
}

/** 客户端：只返回维护态/可用态，off 时无任何国别数据 */
@Controller("v1/global-access")
@UseGuards(RealmGuard)
@RealmAllowed("staff", "customer", "partner", "service")
@AllowAnonymous()
export class PublicDataSourceController {
  constructor(private readonly sources: DataSourceService) {}

  @Get(":key/status")
  status(@Param("key") key: string) {
    return this.sources.publicStatus(key);
  }
}

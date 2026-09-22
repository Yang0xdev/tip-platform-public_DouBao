import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { MachinesController } from "./machines.controller.js";
import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";
import { RealmGuard } from "./realm.guard.js";

@Module({
  imports: [],
  controllers: [HealthController, MachinesController, AuditController],
  providers: [AuditService, RealmGuard]
})
export class AppModule {}

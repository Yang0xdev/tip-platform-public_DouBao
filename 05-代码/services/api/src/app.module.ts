import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { MachinesController } from "./machines.controller.js";
import { AuditController } from "./audit.controller.js";
import { FeatureFlagController } from "./feature-flag.controller.js";
import { AuditService } from "./audit.service.js";
import { FeatureFlagService } from "./feature-flag.service.js";
import { RealmGuard } from "./realm.guard.js";

@Module({
  imports: [],
  controllers: [HealthController, MachinesController, AuditController, FeatureFlagController],
  providers: [AuditService, FeatureFlagService, RealmGuard]
})
export class AppModule {}

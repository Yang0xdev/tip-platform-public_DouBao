import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { MachinesController } from "./machines.controller.js";
import { AuditController } from "./audit.controller.js";
import { FeatureFlagController } from "./feature-flag.controller.js";
import { AdminCatalogController } from "./catalog/admin-catalog.controller.js";
import { PublicCatalogController } from "./catalog/public-catalog.controller.js";
import { AuditService } from "./audit.service.js";
import { FeatureFlagService } from "./feature-flag.service.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { RealmGuard } from "./realm.guard.js";

@Module({
  imports: [],
  controllers: [
    HealthController,
    MachinesController,
    AuditController,
    FeatureFlagController,
    AdminCatalogController,
    PublicCatalogController
  ],
  providers: [AuditService, FeatureFlagService, CatalogService, RealmGuard]
})
export class AppModule {}

import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { MachinesController } from "./machines.controller.js";
import { AuditController } from "./audit.controller.js";
import { FeatureFlagController } from "./feature-flag.controller.js";
import { AdminCatalogController } from "./catalog/admin-catalog.controller.js";
import { PublicCatalogController } from "./catalog/public-catalog.controller.js";
import { VerificationController } from "./catalog/verification.controller.js";
import { EntityController } from "./entities/entity.controller.js";
import { AdvisorController, AdminAdvisorController, PublicAdvisorCardController } from "./advisors/advisor.controller.js";
import { AuditService } from "./audit.service.js";
import { FeatureFlagService } from "./feature-flag.service.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { VerificationService } from "./catalog/verification.service.js";
import { EntityService } from "./entities/entity.service.js";
import { OnboardingService } from "./advisors/onboarding.service.js";
import { AuthorizationService } from "./advisors/authorization.service.js";
import { AdvisorCardService } from "./advisors/advisor-card.service.js";
import { RealmGuard } from "./realm.guard.js";

@Module({
  imports: [],
  controllers: [
    HealthController,
    MachinesController,
    AuditController,
    FeatureFlagController,
    AdminCatalogController,
    PublicCatalogController,
    VerificationController,
    EntityController,
    AdvisorController,
    AdminAdvisorController,
    PublicAdvisorCardController
  ],
  providers: [
    AuditService,
    FeatureFlagService,
    VerificationService,
    CatalogService,
    EntityService,
    OnboardingService,
    AuthorizationService,
    AdvisorCardService,
    RealmGuard
  ]
})
export class AppModule {}

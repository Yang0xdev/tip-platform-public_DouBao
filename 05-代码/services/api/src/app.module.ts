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
import { AdminAssessmentController, PublicAssessmentController } from "./assessment/assessment.controller.js";
import { AdminDataSourceController, PublicDataSourceController } from "./globalaccess/data-source.controller.js";
import { QualityController } from "./quality/quality.controller.js";
import { AuditService } from "./audit.service.js";
import { FeatureFlagService } from "./feature-flag.service.js";
import { CatalogService } from "./catalog/catalog.service.js";
import { VerificationService } from "./catalog/verification.service.js";
import { EntityService } from "./entities/entity.service.js";
import { OnboardingService } from "./advisors/onboarding.service.js";
import { AuthorizationService } from "./advisors/authorization.service.js";
import { AdvisorCardService } from "./advisors/advisor-card.service.js";
import { AssessmentTemplateService } from "./assessment/template.service.js";
import { RuleSetService } from "./assessment/ruleset.service.js";
import { DataSourceService } from "./globalaccess/data-source.service.js";
import { QualityService } from "./quality/quality.service.js";
import { RealmGuard } from "./realm.guard.js";
import { EngagementService } from "./engagement/engagement.service.js";
import { EngagementCustomerController } from "./engagement/engagement-customer.controller.js";
import { EngagementAdvisorController } from "./engagement/engagement-advisor.controller.js";
import { EngagementAdminController } from "./engagement/engagement-admin.controller.js";
import { ProposalService } from "./proposal/proposal.service.js";
import { ProposalAdvisorController, ProposalAdminController, ProposalCustomerController } from "./proposal/proposal.controller.js";
import { OrderService } from "./order/order.service.js";
import { OrderAdvisorController, OrderAdminController, OrderCustomerController, ContractTemplateAdminController } from "./order/order.controller.js";
import { PaymentService } from "./payment/payment.service.js";
import { PaymentCustomerController, PaymentAdminController, ChangeRequestAdminController } from "./payment/payment.controller.js";
import { ClientDetailService } from "./clientdetail/clientdetail.service.js";
import { ClientDetailAdvisorController, FollowUpCustomerController } from "./clientdetail/clientdetail.controller.js";
import { IpadService } from "./ipad/ipad.service.js";
import { IpadController } from "./ipad/ipad.controller.js";
import { PrismaService } from "./persistence/prisma.service.js";
import { SnapshotStore } from "./persistence/snapshot.store.js";

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
    PublicAdvisorCardController,
    AdminAssessmentController,
    PublicAssessmentController,
    AdminDataSourceController,
    PublicDataSourceController,
    QualityController,
    EngagementCustomerController,
    EngagementAdvisorController,
    EngagementAdminController,
    ProposalAdvisorController,
    ProposalAdminController,
    ProposalCustomerController,
    OrderAdvisorController,
    OrderAdminController,
    OrderCustomerController,
    ContractTemplateAdminController,
    PaymentCustomerController,
    PaymentAdminController,
    ChangeRequestAdminController,
    ClientDetailAdvisorController,
    FollowUpCustomerController,
    IpadController
  ],
  providers: [
    PrismaService,
    SnapshotStore,
    AuditService,
    FeatureFlagService,
    VerificationService,
    CatalogService,
    EntityService,
    OnboardingService,
    AuthorizationService,
    AdvisorCardService,
    AssessmentTemplateService,
    RuleSetService,
    DataSourceService,
    QualityService,
    RealmGuard,
    EngagementService,
    ProposalService,
    OrderService,
    PaymentService,
    ClientDetailService,
    IpadService
  ]
})
export class AppModule {}

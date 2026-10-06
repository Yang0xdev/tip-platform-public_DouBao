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
import { CaseService } from "./case/case.service.js";
import { CaseAdminController, CaseAdvisorController, CaseCustomerController } from "./case/case.controller.js";
import { TaskService } from "./task/task.service.js";
import { TaskAdminController, TaskAdvisorController, TaskCustomerController } from "./task/task.controller.js";
import { MaterialService } from "./material/material.service.js";
import { MaterialAdminController, MaterialCustomerController, MaterialAdvisorController } from "./material/material.controller.js";
import { TimelineService } from "./timeline/timeline.service.js";
import { TimelineAdminController, TimelineCustomerController } from "./timeline/timeline.controller.js";
import { ConsentService } from "./consent/consent.service.js";
import { NotificationService } from "./notification/notification.service.js";
import { NotificationAdminController, NotificationCustomerController } from "./notification/notification.controller.js";
import { ProviderService } from "./provider/provider.service.js";
import { ProviderAdminController } from "./provider/provider.controller.js";
import { PortalService } from "./portal/portal.service.js";
import { PortalAdminController, PortalPartnerController } from "./portal/portal.controller.js";
import { HandoverService } from "./handover/handover.service.js";
import { HandoverAdminController, HandoverCustomerController } from "./handover/handover.controller.js";
import { TicketAdminController, TicketAdvisorController, TicketCustomerController } from "./ticket/ticket.controller.js";
import { CommissionAdminController, CommissionAdvisorController } from "./commission/commission.controller.js";
import { ComplianceEventAdminController } from "./compliance/compliance-event.controller.js";
import { DeletionAdminController, DeletionCustomerController } from "./deletion/deletion.controller.js";
import { InviteAdminController } from "./invite/invite.controller.js";
import { SeedLogController } from "./deletion/seed-log.controller.js";
import { AiService } from "./ai/ai.service.js";
import { AiController } from "./ai/ai.controller.js";
import { AiContextService } from "./ai/context.service.js";
import { WikiController } from "./wiki/wiki.controller.js";
import { WikiService } from "./wiki/wiki.service.js";
import { AdvisorAiService } from "./ai/advisor-ai.service.js";
import { AdvisorAiController } from "./ai/advisor-ai.controller.js";
import { KnowledgeService } from "./ai/knowledge.service.js";
import { KnowledgeController } from "./ai/knowledge.controller.js";
import { TicketService } from "./ticket/ticket.service.js";
import { CommissionService } from "./commission/commission.service.js";
import { ComplianceEventService } from "./compliance/compliance-event.service.js";
import { DeletionService } from "./deletion/deletion.service.js";
import { InviteService } from "./invite/invite.service.js";
import { ConsentCustomerController, ConsentAdminController } from "./consent/consent.controller.js";
import { PrismaService } from "./persistence/prisma.service.js";
import { SnapshotStore } from "./persistence/snapshot.store.js";
import { StateOrchestrator } from "./persistence/state.orchestrator.js";
import { PersistenceController } from "./persistence/persistence.controller.js";
import { AiHubController } from "./aihub/aihub.controller.js";
import { RefineryController } from "./refinery/refinery.controller.js";
import { RefineryService } from "./refinery/refinery.service.js";
import { LayoutParser } from "./refinery/parser.service.js";
import { ExtractionEngine } from "./refinery/extractor.service.js";
import { Normalizer } from "./refinery/normalizer.service.js";
import { ModelRegistry } from "./aihub/model.registry.js";
import { ModelRouter } from "./aihub/model.router.js";
import { AiEvalService } from "./aihub/eval.service.js";

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
    IpadController,
    CaseAdminController,
    CaseAdvisorController,
    CaseCustomerController,
    TaskAdminController,
    TaskAdvisorController,
    TaskCustomerController,
    MaterialAdminController,
    MaterialCustomerController,
    MaterialAdvisorController,
    TimelineAdminController,
    TimelineCustomerController,
    ConsentCustomerController,
    ConsentAdminController,
    NotificationAdminController,
    NotificationCustomerController,
    ProviderAdminController,
    PortalAdminController,
    PortalPartnerController,
    HandoverAdminController,
    HandoverCustomerController,
    TicketCustomerController,
    TicketAdminController,
    TicketAdvisorController,
    CommissionAdminController,
    CommissionAdvisorController,
    ComplianceEventAdminController,
    DeletionCustomerController,
    DeletionAdminController,
    InviteAdminController,
    SeedLogController,
    AiController,
    AdvisorAiController,
    WikiController,
    KnowledgeController,
    PersistenceController,
    AiHubController,
    RefineryController
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
    IpadService,
    CaseService,
TaskService,
MaterialService,
TimelineService,
AiService,
AdvisorAiService,
KnowledgeService,
    AiContextService,
    WikiService,
    ConsentService,
    NotificationService,
    ProviderService,
    PortalService,
    HandoverService,
    TicketService,
    CommissionService,
    ComplianceEventService,
    DeletionService,
    InviteService,
    StateOrchestrator,
    ModelRegistry,
    ModelRouter,
    AiEvalService,
    LayoutParser,
    ExtractionEngine,
    Normalizer,
    RefineryService
  ]
})
export class AppModule {}

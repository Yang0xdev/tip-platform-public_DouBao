import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { OrderService, type OrderConfig } from "./order.service.js";
import { ProposalService } from "../proposal/proposal.service.js";

/** 顾问端：订单查询、阻断详情、重建通道（M2-09） */
@Controller("advisor/orders")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class OrderAdvisorController {
  constructor(
    private readonly orders: OrderService,
    private readonly proposals: ProposalService
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return { records: this.orders.advisorOrders(actor.user) };
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.orders.getById(id, { realm: "advisor", ref: actor.user });
  }

  @Get(":id/block-reason")
  blockReason(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.orders.blockReason(id, { realm: "advisor", ref: actor.user });
  }

  /** S-08 重建/异常通道：由已确认方案生成订单草稿 */
  @Post("drafts")
  draft(@Body() body: { proposalId: string }, @CurrentActor() actor: Actor) {
    const p = this.proposals.getById(body.proposalId, { realm: "advisor", ref: actor.user });
    return this.orders.createFromProposal(p, actor.user);
  }
}

/** 后台：订单全链路 + 配置 + 合同模板（M2-09/10） */
@Controller("admin/orders")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class OrderAdminController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  list() {
    return { records: this.orders.list() };
  }

  @Get("config")
  getConfig() {
    return this.orders.getConfig();
  }

  @Put("config")
  updateConfig(@Body() body: Partial<OrderConfig>, @CurrentActor() actor: Actor) {
    return this.orders.updateConfig(body, actor.user);
  }

  @Post(":id/subject-check")
  subjectCheck(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.orders.runSubjectCheck(id, actor.user);
  }

  @Post(":id/signing/start")
  startSigning(@Param("id") id: string, @Body() body: { templateId: string }, @CurrentActor() actor: Actor) {
    return this.orders.startSigning(id, body.templateId, actor.user);
  }

  @Post(":id/contract/register")
  register(
    @Param("id") id: string,
    @Body() body: { signedAt: string; artifactRef: string; method?: "offline" | "esign"; registrarId: string },
    @CurrentActor() actor: Actor
  ) {
    return this.orders.registerSigned(id, body, actor.user);
  }

  @Post(":id/make-effective")
  makeEffective(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.orders.makeEffective(id, actor.user);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.orders.cancel(id, actor.user, body.reason);
  }
}

/** 后台：合同模板版本化（A05-tpl） */
@Controller("admin/contract-templates")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class ContractTemplateAdminController {
  constructor(private readonly orders: OrderService) {}

  @Get()
  list() {
    return { records: this.orders.listTemplates() };
  }

  @Post("drafts")
  draft(@Body() body: { title: string }, @CurrentActor() actor: Actor) {
    return this.orders.createTemplateDraft(body, actor.user);
  }

  @Post(":id/update")
  update(
    @Param("id") id: string,
    @Body() body: Partial<{ scope: boolean; refund: boolean; overseasNotice: boolean; guarantee: boolean; privacy: boolean }>,
    @CurrentActor() actor: Actor
  ) {
    return this.orders.updateTemplate(id, body, actor.user);
  }

  @Post(":id/publish")
  publish(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.orders.publishTemplate(id, actor.user);
  }
}

/** 客户端：订单查看 + 逐条告知确认（M2-10） */
@Controller("v1/orders")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class OrderCustomerController {
  constructor(private readonly orders: OrderService) {}

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.orders.customerOrders(actor.user) };
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.orders.getById(id, { realm: "customer", ref: actor.user });
  }

  @Post(":id/consents")
  consent(@Param("id") id: string, @Body() body: { key: "fees" | "non_commitment" | "privacy" }, @CurrentActor() actor: Actor) {
    return this.orders.addConsent(id, body.key, actor.user);
  }
}

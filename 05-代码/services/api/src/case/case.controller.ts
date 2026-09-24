import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import type { CaseEvent } from "@tip/core";
import { CaseService, type ExceptionKind } from "./case.service.js";
import { OrderService } from "../order/order.service.js";

/** 后台：案件看板、阶段推进、异常登记（M3-01） */
@Controller("admin/cases")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class CaseAdminController {
  constructor(
    private readonly cases: CaseService,
    private readonly orders: OrderService
  ) {}

  @Get("board")
  board() {
    return this.cases.board();
  }

  /** 手动兜底建案（正常路径为首付核验自动建案） */
  @Post("from-order")
  fromOrder(@Body() body: { orderId: string }, @CurrentActor() actor: Actor) {
    const o = this.orders.getById(body.orderId, { realm: "staff", ref: actor.user });
    return this.cases.createFromOrder(o, actor.user);
  }

  @Post(":id/stage")
  stage(
    @Param("id") id: string,
    @Body() body: { event: CaseEvent; evidenceRef?: string; verifierId?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.cases.transition(id, body.event, actor.user, {
      evidenceRef: body.evidenceRef,
      verifierId: body.verifierId
    });
  }

  @Post(":id/exception")
  exception(
    @Param("id") id: string,
    @Body() body: { kind: ExceptionKind; reason: string; clear?: boolean },
    @CurrentActor() actor: Actor
  ) {
    return body.clear
      ? this.cases.clearException(id, body.kind, body.reason, actor.user)
      : this.cases.setException(id, body.kind, body.reason, actor.user);
  }
}

/** 顾问端：案件只读列表（M3-12 阶段只读部分） */
@Controller("advisor/cases")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class CaseAdvisorController {
  constructor(private readonly cases: CaseService) {}

  @Get()
  mine(@CurrentActor() actor: Actor) {
    return { records: this.cases.listForAdvisor(actor.user) };
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.cases.getScoped(id, { realm: "staff", ref: actor.user });
  }
}

/** 客户端：我的案件列表与详情（M3-13） */
@Controller("v1/cases")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class CaseCustomerController {
  constructor(private readonly cases: CaseService) {}

  @Get()
  mine(@CurrentActor() actor: Actor) {
    return { records: this.cases.listForCustomer(actor.user) };
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.cases.getScoped(id, { realm: "customer", ref: actor.user });
  }
}

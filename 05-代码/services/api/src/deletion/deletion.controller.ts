import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { DeletionService } from "./deletion.service.js";
import { CaseService } from "../case/case.service.js";
import { OrderService } from "../order/order.service.js";

/* 客户：注销申请 */
@Controller("v1/account")
@UseGuards(RealmGuard)
export class DeletionCustomerController {
  constructor(
    private readonly deletions: DeletionService,
    private readonly cases: CaseService,
    private readonly orders: OrderService
  ) {}

  @Post("deletion")
  @RealmAllowed("customer")
  request(@Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    const openCases = this.cases.listForCustomer(actorUser(actor)).length;
    // 未结清：生效订单（案件开放情况另算）
    const unsettled = this.orders
      .customerOrders(actorUser(actor))
      .some((o) => o.contractState === "effective");
    return this.deletions.request(actorUser(actor), body.reason, openCases > 0 || unsettled, actorUser(actor));
  }

  @Post("deletion/:id/cancel")
  @RealmAllowed("customer")
  cancel(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.deletions.cancel(id, actorUser(actor));
  }

  @Get("deletion/mine")
  @RealmAllowed("customer")
  mine(@CurrentActor() actor: Actor) {
    return this.deletions.forCustomer(actorUser(actor)) ?? null;
  }
}

/* 后台：注销队列 + 时钟（匿名化由各域执行） */
@Controller("admin/deletions")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class DeletionAdminController {
  constructor(private readonly deletions: DeletionService) {}

  @Get()
  list() {
    return { records: this.deletions.list() };
  }

  @Post("tick")
  tick(@Body() body: { now: string }) {
    return {
      records: this.deletions.tick(body.now, () => {
        /* 各业务域最小化匿名化：影子期登记，真实 PII 字段在持久化层执行 */
      })
    };
  }
}

function actorUser(a: Actor): string {
  return a.user;
}

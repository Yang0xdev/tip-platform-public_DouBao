import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { TaskService } from "./task.service.js";

/** 后台：任务创建/推进/升级/改期（M3-02） */
@Controller("admin/tasks")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class TaskAdminController {
  constructor(private readonly tasks: TaskService) {}

  @Get()
  list(@Query("caseId") caseId?: string, @Query("overdue") overdue?: string) {
    if (overdue === "1") return { records: this.tasks.overdue() };
    if (caseId) return { records: this.tasks.listForCase(caseId) };
    return { records: this.tasks.list() };
  }

  @Post()
  create(
    @Body()
    body: {
      caseId: string;
      type: string;
      title: string;
      ownerId: string;
      dueAt: string;
      source: "official" | "contract" | "sla";
      t0: boolean;
    },
    @CurrentActor() actor: Actor
  ) {
    return this.tasks.create(body.caseId, body, actor.user);
  }

  @Post(":id/start")
  start(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.tasks.start(id, actor.user);
  }

  @Post(":id/complete")
  complete(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.tasks.complete(id, actor.user);
  }

  @Post(":id/escalate")
  escalate(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.tasks.escalate(id, body.reason, actor.user);
  }

  @Post(":id/reschedule")
  reschedule(
    @Param("id") id: string,
    @Body() body: { newDueAt: string; reason: string; evidenceRef: string; verifierId: string },
    @CurrentActor() actor: Actor
  ) {
    return this.tasks.reschedule(id, body, actor.user);
  }
}

/** 顾问端：我的任务（协同只读，M3-12） */
@Controller("advisor/tasks")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class TaskAdvisorController {
  constructor(private readonly tasks: TaskService) {}

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.tasks.listForOwner(actor.user) };
  }
}

/** 客户端：我的待办（只读，M3-13 首页待办数据源） */
@Controller("v1/tasks")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class TaskCustomerController {
  constructor(
    private readonly tasks: TaskService,
    private readonly cases: import("../case/case.service.js").CaseService
  ) {}

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    const caseIds = new Set(this.cases.listForCustomer(actor.user).map((c) => c.id));
    const records = this.tasks
      .list()
      .filter((t) => caseIds.has(t.caseId) && t.state !== "done")
      // 对客只回协同必要字段，不含内部升级链明细
      .map((t) => ({
        caseId: t.caseId,
        title: t.title,
        dueAt: t.dueAt,
        t0: t.t0,
        state: t.state === "escalated" ? "overdue" : t.state
      }));
    return { records };
  }
}

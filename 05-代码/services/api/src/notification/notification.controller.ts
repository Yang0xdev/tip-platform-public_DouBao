import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { NotificationService, type Channel, type ChannelPrefs } from "./notification.service.js";
import { TaskService } from "../task/task.service.js";

/** 后台：模板四眼、送达回执、时钟驱动、升级、一般通知（M3-06） */
@Controller("admin/notifications")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class NotificationAdminController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly tasks: TaskService
  ) {}

  @Get("templates")
  templates() {
    return { records: this.notifications.listTemplates() };
  }

  @Post("templates")
  create(
    @Body()
    body: {
      code: string;
      category: "t0" | "t1" | "general";
      title: string;
      body: string;
      safeSummary: string;
      channels: Channel[];
    },
    @CurrentActor() actor: Actor
  ) {
    return this.notifications.createTemplate({ ...body, authorId: actor.user }, actor.user);
  }

  @Post("templates/:id/submit")
  submit(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.notifications.submitTemplate(id, actor.user);
  }

  @Post("templates/:id/review")
  review(
    @Param("id") id: string,
    @Body() body: { decision: "published" | "draft" },
    @CurrentActor() actor: Actor
  ) {
    return this.notifications.reviewTemplate(id, body.decision, actor.user);
  }

  @Get("deliveries")
  deliveries(@Query("caseId") caseId: string) {
    return { records: this.notifications.listForCase(caseId) };
  }

  @Get("escalations")
  escalations() {
    return { records: this.notifications.escalations() };
  }

  /** 服务端时钟：任务快照由 TaskService 传入 */
  @Post("tick")
  tick(@Body() body: { nowIso: string; caseId?: string }) {
    const taskList = this.tasks.listForCase(body.caseId ?? "");
    return { records: this.notifications.tick(body.nowIso, taskList) };
  }

  @Post("manual")
  manual(
    @Body() body: { caseId: string; templateId: string; recipientRef: string },
    @CurrentActor() actor: Actor
  ) {
    return this.notifications.sendManual(body.caseId, body.templateId, body.recipientRef, actor.user);
  }

  @Get("prefs")
  prefs(@Query("caseId") caseId: string): ChannelPrefs {
    return this.notifications.getPrefs(caseId);
  }
}

/** 客户端：我的通知回执、已读、通道偏好（M3-06/P-13） */
@Controller("v1/notifications")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class NotificationCustomerController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Query("caseId") caseId: string, @CurrentActor() actor: Actor) {
    return { records: this.notifications.viewForCustomer(caseId, actor.user) };
  }

  @Post(":id/read")
  read(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.notifications.markRead(id, actor.user);
  }

  @Get("prefs")
  getPrefs(@Query("caseId") caseId: string): ChannelPrefs {
    return this.notifications.getPrefs(caseId);
  }

  @Post("prefs")
  updatePrefs(@Body() body: { caseId: string } & ChannelPrefs, @CurrentActor() actor: Actor) {
    const { caseId, ...next } = body;
    return this.notifications.updatePrefs(caseId, next, actor.user);
  }
}

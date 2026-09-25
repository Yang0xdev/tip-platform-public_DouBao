import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { MaterialService, type TemplateItem } from "./material.service.js";

/** 后台：清单生成、审核退回、模板管理（M3-03） */
@Controller("admin/materials")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class MaterialAdminController {
  constructor(private readonly materials: MaterialService) {}

  @Get()
  list(@Query("caseId") caseId: string) {
    return { records: this.materials.listForCase(caseId) };
  }

  @Post("checklist")
  checklist(@Body() body: { caseId: string }, @CurrentActor() actor: Actor) {
    return { records: this.materials.generateChecklist(body.caseId, actor.user) };
  }

  @Post(":id/review")
  review(
    @Param("id") id: string,
    @Body() body: { decision: "approve" | "return"; reason?: string; requirement?: string; deadlineAt?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.materials.review(id, body.decision, body, actor.user);
  }

  @Get("templates/:projectCode")
  getTemplate(@Param("projectCode") projectCode: string) {
    return { projectCode, items: this.materials.getTemplate(projectCode) };
  }

  @Put("templates/:projectCode")
  putTemplate(
    @Param("projectCode") projectCode: string,
    @Body() body: { items: TemplateItem[] },
    @CurrentActor() actor: Actor
  ) {
    return this.materials.putTemplate(projectCode, body.items, actor.user);
  }
}

/** 客户端：清单查看、受控上传、原件查看（M3-03） */
@Controller("v1/materials")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class MaterialCustomerController {
  constructor(private readonly materials: MaterialService) {}

  @Get()
  list(@Query("caseId") caseId: string, @CurrentActor() actor: Actor) {
    return { records: this.materials.listForCustomer(actor.user, caseId) };
  }

  @Post("upload")
  upload(
    @Body()
    body: {
      caseId: string;
      personRef: string;
      itemCode: string;
      fileHash: string;
      artifactRef: string;
      mime: string;
      sizeBytes: number;
    },
    @CurrentActor() actor: Actor
  ) {
    return this.materials.upload(body.caseId, body.personRef, body.itemCode, body, actor.user);
  }

  @Get(":id/artifact")
  artifact(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.materials.getArtifact(id, actor.user, "customer");
  }
}

/** 顾问端：材料状态只读，不回原件引用（M3-12） */
@Controller("advisor/materials")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class MaterialAdvisorController {
  constructor(private readonly materials: MaterialService) {}

  @Get()
  list(@Query("caseId") caseId: string) {
    return { records: this.materials.listForAdvisor(caseId) };
  }
}

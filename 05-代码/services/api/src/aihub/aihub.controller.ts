/* AI 中枢：总后台管理端点（V4 P0，staff） */

import { Body, Controller, Get, Post } from "@nestjs/common";
import { RealmAllowed } from "../realm.guard.js";
import { ModelRegistry } from "./model.registry.js";
import { ModelRouter } from "./model.router.js";
import { AiEvalService } from "./eval.service.js";
import type { RouteRequest } from "./model.types.js";

@Controller("admin/aihub")
export class AiHubController {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly router: ModelRouter,
    private readonly evalService: AiEvalService
  ) {}

  /** 模型矩阵 + 实时状态（首次访问若未探测则返回目录，状态待 probe） */
  @Get("models")
  @RealmAllowed("staff")
  models() {
    return {
      probe: this.registry.getLastProbeInfo(),
      statuses: this.registry.getStatuses(),
      catalog: this.registry.getCatalog()
    };
  }

  /** 重新探测目标 Ollama 实例 */
  @Post("probe")
  @RealmAllowed("staff")
  async probe() {
    const statuses = await this.registry.probe();
    return { probe: this.registry.getLastProbeInfo(), statuses };
  }

  /** 路由试跑：给定任务描述，返回将选用的模型档位与候选标签 */
  @Post("route")
  @RealmAllowed("staff")
  route(@Body() body: RouteRequest) {
    return this.router.route(body);
  }

  /** 最近一次评测报告（不自动执行） */
  @Get("eval/report")
  @RealmAllowed("staff")
  report() {
    return this.evalService.run();
  }

  /** 立即跑评测/红队 */
  @Post("eval/run")
  @RealmAllowed("staff")
  runEval() {
    return this.evalService.run();
  }
}

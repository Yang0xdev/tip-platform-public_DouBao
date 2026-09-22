import { Injectable } from "@nestjs/common";
import { EntityService } from "../entities/entity.service.js";
import { OnboardingService } from "./onboarding.service.js";
import { AuthorizationService } from "./authorization.service.js";

/**
 * 名片白名单（PRD-M1 M1-11 / C07）：
 * 只返回白名单字段；内部备注、佣金、其他客户、统计假数字一律不存在于响应体；
 * 自述单独审核通过才展示并带"未经平台核验"标识；统计字段本期显示"样本积累中"。
 */
@Injectable()
export class AdvisorCardService {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly grants: AuthorizationService,
    private readonly entities: EntityService
  ) {}

  listForProject(projectCode: string) {
    const entities = this.entities.list();
    return this.grants
      .listAuthorized(projectCode)
      .map((g) => {
        const ob = this.onboarding.getByAdvisor(g.advisorUserId);
        if (!ob || ob.state !== "approved") return null;
        const ent = entities.find((e) => e.id === ob.entityId);
        if (!ent?.usable) return null; // 临期/暂停/到期机构顾问名片不进可选列表
        const authorizedProjects = this.grants
          .list(g.advisorUserId)
          .filter((x) => x.state === "authorized" || x.state === "expiring")
          .map((x) => x.projectCode);
        return {
          name: ob.realName,
          title: ob.title,
          filingNo: ob.filingNo,
          yearsOfPractice: ob.yearsOfPractice,
          entity: { name: ent.name, filingNo: ent.filingNo, status: ent.displayStatus, filingExpiresAt: ent.filingExpiresAt },
          authorizedProjects,
          selfIntro: ob.selfIntroApproved
            ? { text: ob.selfIntro, note: "自述内容，未经平台核验" }
            : null,
          stats: { caseCount: null, medianResponse: null, note: "样本积累中" },
          violationRecord: { note: "无已核实记录" },
          actions: { note: "即将开放" } // 预约/请求服务 M1 置灰，不产生关系与归属
        };
      })
      .filter(Boolean);
  }
}

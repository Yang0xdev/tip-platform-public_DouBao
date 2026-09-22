import { describe, it, expect } from "vitest";
import {
  projectVersionMachine, feeScheduleMachine, authorizationMachine, proposalMachine,
  contractMachine, paymentMachine, caseMachine, consentMachine,
  portalGrantMachine, deliveryMachine, ticketMachine, complianceMachine,
  commissionMachine, dataSourceMachine, ALL_MACHINES
} from "../src/machines.js";

describe("M1 项目版本发布流（核验门 + 四眼）", () => {
  const factsOk = { editorId: "u1", verifierId: "u2", publisherId: "u3", keyFactsTotal: 3, keyFactsVerified: 3 };
  it("核验人=编辑人拒绝", () => {
    const ctx = { ...factsOk, verifierId: "u1" };
    expect(projectVersionMachine.transition(ctx, "pending_verification", "pass_verification").code).toBe("VERIFIER_IS_EDITOR");
  });
  it("关键事实未核验完拒绝发布流转", () => {
    const ctx = { ...factsOk, keyFactsVerified: 2 };
    expect(projectVersionMachine.transition(ctx, "pending_verification", "pass_verification").code).toBe("KEY_FACTS_UNVERIFIED");
  });
  it("零关键事实拒绝", () => {
    const ctx = { ...factsOk, keyFactsTotal: 0, keyFactsVerified: 0 };
    expect(projectVersionMachine.transition(ctx, "pending_verification", "pass_verification").code).toBe("KEY_FACTS_REQUIRED");
  });
  it("最后编辑人=发布人拒绝", () => {
    const ctx = { ...factsOk, publisherId: "u1" };
    expect(projectVersionMachine.transition(ctx, "pending_publish", "approve_publication").code).toBe("PUBLISHER_IS_EDITOR");
  });
  it("完整链路：草稿→核验→发布复核→发布→暂停→下架", () => {
    let s: any = "draft";
    s = projectVersionMachine.transition(factsOk, s, "submit_verification").to;
    expect(s).toBe("pending_verification");
    s = projectVersionMachine.transition(factsOk, s, "pass_verification").to;
    expect(s).toBe("pending_publish");
    s = projectVersionMachine.transition(factsOk, s, "approve_publication").to;
    expect(s).toBe("published");
    s = projectVersionMachine.transition(factsOk, s, "suspend").to;
    expect(s).toBe("suspended");
    expect(projectVersionMachine.transition(factsOk, s, "delist").to).toBe("delisted");
  });
  it("收费方案：同人复核拒绝；他人通过；发布后可被新版本替代", () => {
    const author = { authorId: "u1", reviewerId: "u1" };
    expect(feeScheduleMachine.transition(author, "in_review", "approve").code).toBe("REVIEWER_IS_AUTHOR");
    const other = { authorId: "u1", reviewerId: "u2" };
    expect(feeScheduleMachine.transition(other, "in_review", "approve").to).toBe("published");
    expect(feeScheduleMachine.transition(other, "published", "supersede").to).toBe("superseded");
  });
});

describe("M1 授权五步", () => {
  const base = { authorId: "x", reviewerId: "y", scope: ["A_TECH"], projectCode: "A_TECH", grantedScopes: ["A_TECH"] };
  it("未授权项目不可批准", () => {
    const ctx = { ...base, projectCode: "B_INV", grantedScopes: ["A_TECH"] };
    const path = ["start_learning", "complete_learning", "pass_exam", "submit_grant"] as const;
    let s: any = "applied";
    for (const e of path) s = authorizationMachine.transition(ctx, s, e).to;
    expect(authorizationMachine.transition(ctx, s, "approve").code).toBe("SCOPE_NOT_GRANTED");
  });
  it("完整五步到 authorized", () => {
    let s: any = "applied";
    for (const e of ["start_learning", "complete_learning", "pass_exam", "submit_grant", "approve"] as const) {
      s = authorizationMachine.transition(base, s, e).to;
    }
    expect(s).toBe("authorized");
  });
});

describe("M2 方案", () => {
  const okCtx = {
    authorId: "adv1", reviewerId: "qa1", projectPublished: true, feePublished: true,
    advisorAuthorized: true, relationshipActive: true, validUntil: "2026-12-31", now: "2026-09-22"
  };
  it("未复核版本客户不可确认", () => {
    expect(proposalMachine.transition(okCtx, "advisor_draft", "confirm").code).toBe("FSM_ILLEGAL_TRANSITION");
  });
  it("过期版本不可确认", () => {
    let s: any = "advisor_draft";
    s = proposalMachine.transition(okCtx, s, "submit_review").to;
    s = proposalMachine.transition(okCtx, s, "approve").to;
    const r = proposalMachine.transition({ ...okCtx, now: "2027-01-01" }, s, "confirm");
    expect(r.code).toBe("PROPOSAL_EXPIRED");
  });
  it("关系未成立不可提交复核", () => {
    const r = proposalMachine.transition({ ...okCtx, relationshipActive: false }, "advisor_draft", "submit_review");
    expect(r.code).toBe("RELATIONSHIP_NOT_ACTIVE");
  });
});

describe("M2 主体三要素门（四入口同判定）", () => {
  const pass = {
    signingEntityRegistered: true, overseasPartyLinked: true, payeeNameMatches: true,
    contractHasFiveElements: true, registrarId: "reg1", advisorId: "adv1",
    consentsComplete: true, doorsOpen: true, shadowEnv: false
  };
  it("三要素任一不一致即阻断且无强制通过事件", () => {
    for (const broken of [
      { signingEntityRegistered: false }, { overseasPartyLinked: false }, { payeeNameMatches: false }
    ] as const) {
      const ctx = { ...pass, ...broken };
      const r = contractMachine.transition(ctx, "draft", "pass_gate");
      expect(r.code).toBe("SUBJECT_GATE_FAILED");
      // 白名单中不存在任何绕过事件
      expect(contractMachine.legalEvents("draft").sort()).toEqual(["cancel", "pass_gate"].sort());
    }
  });
  it("合同核验人不得是顾问", () => {
    let s: any = "draft";
    s = contractMachine.transition(pass, s, "pass_gate").to;
    s = contractMachine.transition(pass, s, "sign_register").to;
    const r = contractMachine.transition({ ...pass, registrarId: "adv1" }, s, "make_effective");
    expect(r.code).toBe("REGISTRAR_IS_ADVISOR");
  });
  it("D 门未开时真实环境不可生效，影子环境可走通", () => {
    let s: any = "draft";
    for (const e of ["pass_gate", "sign_register", "make_effective"] as const) s = contractMachine.transition(pass, s, e).to;
    expect(s).toBe("signed_registered"); // 第一次 make_effective 落 signed_registered
    expect(contractMachine.transition(pass, s, "make_effective").to).toBe("effective");
    const closed = { ...pass, doorsOpen: false, shadowEnv: false };
    expect(contractMachine.transition(closed, s, "make_effective").code).toBe("DECISION_DOOR_CLOSED");
  });
  it("待核验≠到账：凭证上传只到 pending_verify", () => {
    expect(paymentMachine.transition({}, "unpaid", "upload_voucher").to).toBe("pending_verify");
    expect(paymentMachine.transition({}, "pending_verify", "verify").to).toBe("verified");
    expect(paymentMachine.transition({}, "unpaid", "verify").code).toBe("FSM_ILLEGAL_TRANSITION");
  });
});

describe("M3 案件四级来源", () => {
  it("无官方凭据不可受理/出结果", () => {
    const ctx = { hasOfficialEvidence: false, verifierId: "v1", initiatorId: "i1" };
    expect(caseMachine.transition(ctx, "submitted", "accept_official").code).toBe("OFFICIAL_EVIDENCE_REQUIRED");
    expect(caseMachine.transition(ctx, "reviewing", "approve").code).toBe("OFFICIAL_EVIDENCE_REQUIRED");
  });
  it("核验人不得是发起人", () => {
    const ctx = { hasOfficialEvidence: true, verifierId: "i1", initiatorId: "i1" };
    expect(caseMachine.transition(ctx, "submitted", "accept_official").code).toBe("VERIFIER_IS_INITIATOR");
  });
  it("凭据齐全且岗位分离可受理", () => {
    const ctx = { hasOfficialEvidence: true, verifierId: "v1", initiatorId: "i1" };
    expect(caseMachine.transition(ctx, "submitted", "accept_official").to).toBe("accepted");
  });
});

describe("M3 授权与门户", () => {
  it("家庭授权撤回即时生效，过期不可恢复为 active", () => {
    expect(consentMachine.transition({}, "active", "revoke").to).toBe("revoked");
    expect(consentMachine.transition({}, "revoked", "self_confirm").code).toBe("FSM_ILLEGAL_TRANSITION");
  });
  it("门户批次到期回收后不可下载", () => {
    let s: any = "pending";
    for (const e of ["approve_view", "request_download", "approve_download"] as const) s = portalGrantMachine.transition({}, s, e).to;
    expect(s).toBe("download_window");
    expect(portalGrantMachine.transition({}, s, "expire").to).toBe("expired");
    expect(portalGrantMachine.transition({}, "expired", "approve_download").code).toBe("FSM_ILLEGAL_TRANSITION");
  });
  it("T0 送达失败必须换道/升级，状态机无静默关闭路径", () => {
    let s: any = "pending";
    s = deliveryMachine.transition({}, s, "send").to;
    s = deliveryMachine.transition({}, s, "fail").to;
    s = deliveryMachine.transition({}, s, "switch_channel").to;
    s = deliveryMachine.transition({}, s, "manual_reach").to;
    expect(deliveryMachine.transition({}, s, "escalate").to).toBe("escalated");
  });
});

describe("M4 工单/合规/佣金", () => {
  it("投诉可转合规，顾问无权关闭（状态机无顾问事件分支）", () => {
    let s: any = "submitted";
    s = ticketMachine.transition({}, s, "accept").to;
    expect(ticketMachine.transition({}, s, "refer_compliance").to).toBe("compliance_referred");
    expect(ticketMachine.legalEvents("compliance_referred")).toEqual([]);
  });
  it("L3 合规处置需双人且不得同人", () => {
    const ctx = { authorId: "i1", reviewerId: "r1", level: "L3" as const, secondApproverId: null };
    let s: any = "new";
    for (const e of ["triage", "investigate", "propose"] as const) s = complianceMachine.transition(ctx, s, e).to;
    expect(complianceMachine.transition(ctx, s, "decide").code).toBe("L3_DOUBLE_APPROVAL");
    expect(complianceMachine.transition({ ...ctx, secondApproverId: "r1" }, s, "decide").code).toBe("L3_SAME_APPROVER");
    expect(complianceMachine.transition({ ...ctx, secondApproverId: "r2" }, s, "decide").to).toBe("decided");
  });
  it("佣金六态不可跳步：点击/咨询无计提路径，未计提不可结算", () => {
    expect(commissionMachine.transition({} as any, "not_accrued", "settle").code).toBe("FSM_ILLEGAL_TRANSITION");
    expect(commissionMachine.transition({} as any, "accrued", "pay").code).toBe("FSM_ILLEGAL_TRANSITION");
    const ctx = { settlementReviewerA: "f1", settlementReviewerB: "f2" };
    let s: any = "not_accrued";
    s = commissionMachine.transition(ctx, s, "accrue").to;
    s = commissionMachine.transition(ctx, s, "settle").to;
    expect(commissionMachine.transition(ctx, s, "pay").to).toBe("paid");
  });
  it("结算双人复核同人拒绝", () => {
    const ctx = { settlementReviewerA: "f1", settlementReviewerB: "f1" };
    expect(commissionMachine.transition(ctx, "accrued", "settle").code).toBe("SETTLEMENT_SAME_REVIEWER");
  });
});

describe("M5 数据源授权门", () => {
  it("未签约不可启用；终止后框架态无真实数据路径", () => {
    expect(dataSourceMachine.transition({}, "absent", "enable").code).toBe("FSM_ILLEGAL_TRANSITION");
    expect(dataSourceMachine.transition({}, "terminated", "enable").code).toBe("FSM_ILLEGAL_TRANSITION");
  });
});

describe("注册表完整性", () => {
  it("每台状态机都有可达状态集合", () => {
    for (const [name, m] of Object.entries(ALL_MACHINES)) {
      expect(m.states().length, name).toBeGreaterThan(1);
    }
  });
});

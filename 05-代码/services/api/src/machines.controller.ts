import { BadRequestException, Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ALL_MACHINES } from "@tip/core";
import { RealmAllowed, RealmGuard, CurrentActor, type Actor } from "./realm.guard.js";

/**
 * 状态机只读探查端点（M0 Spike）：
 * 证明后端与前端共用 @tip/core 同一份状态真源；后续业务端点调用 transition() 落事件。
 */
@Controller("v1/_meta/machines")
@UseGuards(RealmGuard)
@RealmAllowed("staff", "customer", "partner", "service")
export class MachinesController {
  @Get()
  list(@CurrentActor() actor: Actor | null) {
    return {
      machines: Object.keys(ALL_MACHINES),
      states: Object.fromEntries(Object.entries(ALL_MACHINES).map(([k, m]) => [k, m.states()])),
      requestedBy: actor?.user
    };
  }

  @Get(":name/legal-events")
  legalEvents(@Param("name") name: string, @Query("state") state: string) {
    const machine = (ALL_MACHINES as Record<string, (typeof ALL_MACHINES)[keyof typeof ALL_MACHINES]>)[name];
    if (!machine) throw new BadRequestException({ code: 40001, message: `未知状态机: ${name}` });
    const states = machine.states();
    if (!states.includes(state as never)) throw new BadRequestException({ code: 40002, message: `未知状态: ${state}` });
    return { machine: name, state, legalEvents: machine.legalEvents(state as never) };
  }
}

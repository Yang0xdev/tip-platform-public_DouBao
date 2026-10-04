import { Controller, Get } from "@nestjs/common";
import { RealmAllowed } from "../realm.guard.js";
import { StateOrchestrator } from "./state.orchestrator.js";

@Controller("v1/persistence")
export class PersistenceController {
  constructor(private readonly state: StateOrchestrator) {}

  /** 持久化状态（seed 据此判断是否跳过；staff 可查） */
  @Get("status")
  @RealmAllowed("staff")
  status() {
    return this.state.status();
  }
}

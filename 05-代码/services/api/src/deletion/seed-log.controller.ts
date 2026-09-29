import { Controller, Get, UseGuards } from "@nestjs/common";
import { RealmAllowed, RealmGuard } from "../realm.guard.js";
import { readFileSync } from "node:fs";

/** 临时部署诊断：读取容器内 seed 输出（仅 staff；上线前移除） */
@Controller("admin/seed-log")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class SeedLogController {
  @Get()
  read() {
    try {
      return { log: readFileSync("/tmp/seed.log", "utf8").slice(-6000) };
    } catch {
      return { log: null, hint: "/tmp/seed.log 不存在" };
    }
  }
}

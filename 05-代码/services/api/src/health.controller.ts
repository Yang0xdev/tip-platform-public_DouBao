import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return { status: "ok", service: "tip-api", stage: "M0", time: new Date().toISOString() };
  }
}

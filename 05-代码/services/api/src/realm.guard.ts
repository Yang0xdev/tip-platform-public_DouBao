import { CanActivate, ExecutionContext, Injectable, ForbiddenException, UnauthorizedException, SetMetadata, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuditService } from "./audit.service.js";

/**
 * 四类账号 realm（技术方案 §3）：
 * - staff：员工（后台/顾问，Keycloak + MFA）
 * - customer：客户（手机验证码）
 * - partner：服务方门户（独立 realm + MFA）
 * - service：服务间账号
 * M0 用请求头 x-tip-realm / x-tip-user 模拟（dev/test）；M1 接 Keycloak JWT 解析。
 */
export type Realm = "staff" | "customer" | "partner" | "service";

export interface Actor {
  realm: Realm;
  user: string;
}

export const REALMS_KEY = "allowed_realms";
/** 控制器/方法声明允许的 realm（白名单，默认全拒绝） */
export const RealmAllowed = (...realms: Realm[]) => SetMetadata(REALMS_KEY, realms);

export const ANON_KEY = "allow_anonymous";
/**
 * 游客端点（M1-12 首页游客态 / M1-13 发现与详情 / M1-08 无状态初评）：
 * 无身份可访问（默认仅 GET；无状态计算类 POST 显式声明），有身份仍须在白名单内。
 */
export const AllowAnonymous = (methods: string[] = ["GET"]) => SetMetadata(ANON_KEY, methods);

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor | null => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const realm = req.header("x-tip-realm") as Realm | undefined;
  const user = req.header("x-tip-user");
  if (!realm || !user) return null;
  return { realm, user };
});

@Injectable()
export class RealmGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const handler = context.getHandler();
    const cls = context.getClass();
    const allowed = this.reflector.getAllAndOverride<Realm[]>(REALMS_KEY, [handler, cls]) ?? [];
    const anonMethods = this.reflector.getAllAndOverride<string[]>(ANON_KEY, [handler, cls]) ?? [];
    const realm = req.header("x-tip-realm") as Realm | undefined;
    const user = req.header("x-tip-user");
    const action = `${req.method} ${req.path}`;
    const hasIdentity = Boolean(realm && user);

    if (!hasIdentity) {
      if (anonMethods.includes(req.method)) {
        return true; // 游客无状态端点；异常流量在网关层限流
      }
      this.audit.record({ actor: user ?? "anonymous", realm: realm ?? "none", action, resource: req.path, result: "deny", reason: "MISSING_IDENTITY" });
      throw new UnauthorizedException({ code: 40101, message: "未提供身份" });
    }
    if (!allowed.includes(realm!)) {
      this.audit.record({ actor: user!, realm: realm!, action, resource: req.path, result: "deny", reason: "REALM_FORBIDDEN" });
      throw new ForbiddenException({ code: 40301, message: "该终端无权访问此资源" });
    }
    this.audit.record({ actor: user!, realm: realm!, action, resource: req.path, result: "allow" });
    return true;
  }
}

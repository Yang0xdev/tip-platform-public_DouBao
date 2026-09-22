import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 客户端（M1 切片 8）。
 * - 仅当 DATABASE_URL 存在时连接；未配置时 enabled=false，全部服务回退内存实现（单测/无 PG 环境）。
 * - 生产/影子环境必须配置 DATABASE_URL（启动断言在 M5 出口验收补齐）。
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Prisma");
  readonly enabled: boolean;
  private client: PrismaClient | null = null;

  constructor() {
    this.enabled = Boolean(process.env.DATABASE_URL);
    if (this.enabled) {
      this.client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    }
  }

  async onModuleInit() {
    if (!this.client) {
      this.logger.warn("未设置 DATABASE_URL，使用内存仓储（仅限本机单测/演示，不用于影子与生产）");
      return;
    }
    await this.client.$connect();
    this.logger.log("Prisma 已连接 PostgreSQL");
  }

  async onModuleDestroy() {
    await this.client?.$disconnect();
  }

  get db(): PrismaClient {
    if (!this.client) throw new Error("Prisma 未启用（缺少 DATABASE_URL）");
    return this.client;
  }
}

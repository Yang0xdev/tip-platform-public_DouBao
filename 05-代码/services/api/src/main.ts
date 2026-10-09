import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module.js";

// 金额 amountMinor 统一以字符串输出（API 契约）；BigInt 全局 JSON 序列化补丁
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  app.enableCors({ origin: true });
  // PDF/材料 base64 上传：放宽 body 体积上限（默认 100kb 会导致 413）
  app.use(json({ limit: "25mb" }));
  app.use(urlencoded({ limit: "25mb", extended: true }));
  // 启用关停钩子：SIGTERM/SIGINT 时触发 onModuleDestroy，完成状态落盘
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, "0.0.0.0");
  console.log(`tip-api listening on :${port} (M0 skeleton)`);
}

void bootstrap();

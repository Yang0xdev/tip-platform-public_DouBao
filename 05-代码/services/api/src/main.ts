import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

// 金额 amountMinor 统一以字符串输出（API 契约）；BigInt 全局 JSON 序列化补丁
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  app.enableCors({ origin: true });
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, "0.0.0.0");
  console.log(`tip-api listening on :${port} (M0 skeleton)`);
}

void bootstrap();

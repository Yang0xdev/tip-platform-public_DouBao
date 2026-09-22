import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] });
  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port, "0.0.0.0");
  console.log(`tip-api listening on :${port} (M0 skeleton)`);
}

void bootstrap();

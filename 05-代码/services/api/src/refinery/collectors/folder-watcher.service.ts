/* 文件夹自动采集（V4 P3）
 * 轮询监听指定目录（默认 30s），新增/变更的 .txt/.md/.html/.pdf 自动入 L0；
 * 依赖 L0 内容指纹去重，重复文件静默跳过。无配置则不启动。
 */
import { Injectable, Logger } from "@nestjs/common";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export interface IngestInput {
  title: string;
  content?: string;
  base64?: string;
  sourceType: "folder" | "email";
}

export const TEXT_EXT = new Set([".txt", ".md", ".html", ".htm"]);

@Injectable()
export class FolderWatcher {
  private readonly logger = new Logger("FolderWatcher");
  private timer: NodeJS.Timeout | null = null;
  private seen = new Map<string, number>(); // path -> mtimeMs
  lastRunAt: string | null = null;
  lastIngested = 0;

  constructor(
    private readonly dir: string | undefined,
    private readonly intervalSec: number,
    /** 实际入库回调（由 CollectorsService 接到 RefineryService） */
    private readonly ingest: (actorId: string, input: IngestInput) => void
  ) {}

  get enabled() {
    return !!this.dir && existsSync(this.dir);
  }

  start(): void {
    if (!this.dir) {
      this.logger.log("未配置 REFINERY_WATCH_DIR，文件夹采集器未启用");
      return;
    }
    if (!existsSync(this.dir)) {
      this.logger.warn(`REFINERY_WATCH_DIR 不存在：${this.dir}，采集器未启用`);
      return;
    }
    this.logger.log(`文件夹采集器已启用：${this.dir}（每 ${this.intervalSec}s）`);
    void this.scan(true);
    this.timer = setInterval(() => void this.scan(false), this.intervalSec * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 扫描；initial=true 时把已存在文件登记为 seen（不回灌历史，避免刷屏） */
  async scan(initial: boolean): Promise<number> {
    if (!this.dir) return 0;
    let n = 0;
    const walk = (d: string): string[] => {
      const out: string[] = [];
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        const st = statSync(p);
        if (st.isDirectory()) out.push(...walk(p));
        else if (TEXT_EXT.has(extname(name).toLowerCase()) || name.toLowerCase().endsWith(".pdf"))
          out.push(p);
      }
      return out;
    };
    for (const p of walk(this.dir)) {
      const mtime = statSync(p).mtimeMs;
      const prev = this.seen.get(p);
      this.seen.set(p, mtime);
      if (initial || prev === mtime) continue;
      try {
        const title = p.slice(this.dir.length + 1).replace(/\.[^.]+$/, "");
        if (p.toLowerCase().endsWith(".pdf")) {
          this.ingest("system:folder", {
            title, base64: readFileSync(p).toString("base64"), sourceType: "folder"
          });
        } else {
          this.ingest("system:folder", {
            title, content: readFileSync(p, "utf8"), sourceType: "folder"
          });
        }
        n += 1;
      } catch (e) {
        // 409 去重等：记 debug 不中断
        this.logger.debug(`跳过 ${p}：${(e as Error).message}`);
      }
    }
    this.lastRunAt = new Date().toISOString();
    this.lastIngested = n;
    if (n > 0) this.logger.log(`文件夹采集：本轮入库 ${n} 份`);
    return n;
  }
}

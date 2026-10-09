/* 采集器总控（V4 P3）
 * 启动文件夹/邮箱采集器，把外部资料接入 refinery 并自动跑到待复核；
 * 同时向后台暴露采集器状态。
 */
import { Injectable, Logger } from "@nestjs/common";
import { FolderWatcher, type IngestInput } from "./folder-watcher.service.js";
import { ImapCollector } from "./imap-collector.service.js";
import { RefineryService } from "../refinery.service.js";

@Injectable()
export class CollectorsService {
  private readonly logger = new Logger("Collectors");
  readonly folder: FolderWatcher;
  readonly imap: ImapCollector;

  constructor(private readonly refinery: RefineryService) {
    const ingest = async (actorId: string, input: IngestInput) => {
      if (input.base64) {
        const r = await this.refinery.ingestPdf(actorId, {
          title: input.title, base64: input.base64
        });
        await this.refinery.autoRun(actorId, r.id);
      } else if (input.content) {
        const r = this.refinery.ingestText(actorId, {
          title: input.title, content: input.content, sourceType: input.sourceType
        });
        await this.refinery.autoRun(actorId, r.id);
      }
    };

    const watchDir = process.env.REFINERY_WATCH_DIR;
    const folderInterval = Number(process.env.REFINERY_WATCH_INTERVAL ?? 30);
    this.folder = new FolderWatcher(watchDir, folderInterval, (a, i) => {
      void ingest(a, i).catch((e) => this.logger.debug(`folder ingest: ${e.message}`));
    });

    const imapCfg = process.env.IMAP_HOST
      ? {
          host: process.env.IMAP_HOST,
          port: Number(process.env.IMAP_PORT ?? 993),
          secure: process.env.IMAP_SECURE !== "false",
          user: process.env.IMAP_USER ?? "",
          pass: process.env.IMAP_PASS ?? "",
          mailbox: process.env.IMAP_MAILBOX ?? "INBOX"
        }
      : null;
    const imapInterval = Number(process.env.IMAP_INTERVAL ?? 300);
    this.imap = new ImapCollector(imapCfg, imapInterval, (a, i) => {
      void ingest(a, i).catch((e) => this.logger.debug(`imap ingest: ${e.message}`));
    });
  }

  onApplicationBootstrap(): void {
    this.folder.start();
    this.imap.start();
  }

  onModuleDestroy(): void {
    this.folder.stop();
    this.imap.stop();
  }

  status() {
    return {
      folder: {
        enabled: this.folder.enabled,
        lastRunAt: this.folder.lastRunAt,
        lastIngested: this.folder.lastIngested
      },
      imap: {
        enabled: this.imap.enabled,
        lastRunAt: this.imap.lastRunAt,
        lastIngested: this.imap.lastIngested,
        lastError: this.imap.lastError
      }
    };
  }
}

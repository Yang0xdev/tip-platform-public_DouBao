/* 邮箱 IMAP 自动采集（V4 P3）
 * 用 imapflow（纯 JS）轮询指定邮箱，把未处理邮件正文入 L0；
 * 不改动邮件任何标记（不 setSeen），已处理 uid 内存登记，重复内容由 L0 指纹去重。
 * 建议使用邮箱「应用专用密码」，不要使用主密码。
 */
import { Injectable, Logger } from "@nestjs/common";
import { ImapFlow } from "imapflow";

interface ImapConfig {
  host: string; port: number; secure: boolean;
  user: string; pass: string; mailbox: string;
}

interface BsNode {
  partPath?: string;
  type?: string;
  disposition?: string;
  childNodes?: BsNode[];
}

@Injectable()
export class ImapCollector {
  private readonly logger = new Logger("ImapCollector");
  private timer: NodeJS.Timeout | null = null;
  private handledUids = new Set<number>();
  lastRunAt: string | null = null;
  lastIngested = 0;
  lastError: string | null = null;

  constructor(
    private readonly cfg: ImapConfig | null,
    private readonly intervalSec: number,
    private readonly ingest: (actorId: string, input: {
      title: string; content: string; sourceType: "email"
    }) => void
  ) {}

  get enabled() {
    return !!this.cfg?.host && !!this.cfg?.user && !!this.cfg?.pass;
  }

  start(): void {
    if (!this.cfg?.host) {
      this.logger.log("未配置 IMAP_HOST/IMAP_USER/IMAP_PASS，邮箱采集器未启用");
      return;
    }
    this.logger.log(`邮箱采集器已启用：${this.cfg.user}@${this.cfg.host}（每 ${this.intervalSec}s）`);
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalSec * 1000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 收集 bodyStructure 中 text/* 的 part 路径（优先 text/plain，其次 text/html） */
  private textPartPaths(node: BsNode, acc: Array<{ path: string; type: string }>): void {
    if (node.partPath && node.type?.startsWith("text/") && node.disposition !== "attachment")
      acc.push({ path: node.partPath, type: node.type });
    for (const c of node.childNodes ?? []) this.textPartPaths(c, acc);
  }

  async poll(): Promise<number> {
    if (!this.cfg) return 0;
    let n = 0;
    const client = new ImapFlow({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.secure,
      auth: { user: this.cfg.user, pass: this.cfg.pass },
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 15000
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock(this.cfg.mailbox);
      try {
        const searchRes = await client.search({}, { uid: true });
        const uids = Array.isArray(searchRes) ? searchRes : [];
        // 取最近 50 封即可（采集器目的是增量入库）
        const list = uids.slice(-50).filter((u: number) => !this.handledUids.has(u));
        if (list.length > 0) {
          for await (const msg of client.fetch(list, {
            uid: true, envelope: true, bodyStructure: true
          })) {
            const paths: Array<{ path: string; type: string }> = [];
            this.textPartPaths(msg.bodyStructure as BsNode, paths);
            let body = "";
            if (paths.length > 0) {
              // 用 bodyParts 选项拉取文本部分内容
              const full = await client.fetchOne(msg.uid, {
                uid: true, bodyParts: paths.map((p) => p.path)
              }, { uid: true });
              const bp = (full && (full as any).bodyParts) as
                Map<string, { content: Buffer | string }> | undefined;
              const plain = paths.find((p) => p.type === "text/plain");
              const pick = (p: { path: string }) => {
                const v = bp?.get(p.path)?.content;
                return v == null ? "" : Buffer.isBuffer(v) ? v.toString("utf8") : String(v);
              };
              body = (plain ? pick(plain) : paths.map(pick).find((v) => v.trim().length > 0)) ?? "";
            }
            body = body.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
            const subject = msg.envelope?.subject;
            const from = msg.envelope?.from?.[0]?.address;
            const title = `[邮件] ${subject ?? "(无主题)"}${from ? ` · ${from}` : ""}`;
            this.handledUids.add(msg.uid);
            if (body) {
              try {
                this.ingest("system:imap", { title, content: body, sourceType: "email" });
                n += 1;
              } catch (e) {
                this.logger.debug(`邮件 uid=${msg.uid} 跳过：${(e as Error).message}`);
              }
            }
          }
        }
      } finally {
        lock.release();
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = (e as Error).message;
      this.logger.warn(`邮箱轮询失败：${this.lastError}`);
    } finally {
      await client.logout().catch(() => {});
    }
    this.lastRunAt = new Date().toISOString();
    this.lastIngested = n;
    if (n > 0) this.logger.log(`邮箱采集：本轮入库 ${n} 封`);
    return n;
  }
}

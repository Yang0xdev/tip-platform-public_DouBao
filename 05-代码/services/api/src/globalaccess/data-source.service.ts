import { HttpException, Injectable } from "@nestjs/common";

/**
 * 全球通行数据源开关框架（PRD-M1 M1-16 / Q6 门）
 * M1 只有一个内置"未授权"记录，开关强制 off：
 * 客户端任何情况下拿不到签证/护照国别数据；启用必须先具备授权范围、合同期、署名口径与更新节拍。
 * 真实接入在 M5，且授权落地后才允许 on；授权失效自动下架（M5 演练 ≤30 分钟）。
 */

export interface DataSourceAuthorization {
  key: string;
  provider: string | null;
  scope: string | null; // 授权范围
  contractValidUntil: string | null; // 合同期
  refreshCadence: string | null; // 更新节拍
  attribution: string | null; // 署名口径
  cacheTtlHours: number | null;
  state: "off" | "on";
  note: string;
}

export class DataSourceError extends HttpException {
  constructor(status: number, bizCode: string, message: string) {
    super({ code: bizCode, message }, status);
  }
}

@Injectable()
export class DataSourceService {
  private readonly records = new Map<string, DataSourceAuthorization>();

  constructor() {
    this.records.set("visa_passport_data", {
      key: "visa_passport_data",
      provider: null,
      scope: null,
      contractValidUntil: null,
      refreshCadence: null,
      attribution: null,
      cacheTtlHours: null,
      state: "off",
      note: "未授权：签证/护照数据为第三方专有（IATA Timatic 类），授权落地前不对客提供任何国别数据"
    });
  }

  list(): DataSourceAuthorization[] {
    return [...this.records.values()];
  }

  /** 仅允许补齐授权元数据；缺任一授权要件不得开启 */
  configure(key: string, patch: Partial<Omit<DataSourceAuthorization, "key" | "note">>): DataSourceAuthorization {
    const rec = this.require(key);
    const merged = { ...rec, ...patch };
    if (patch.state === "on") {
      const required: Array<keyof DataSourceAuthorization> = ["provider", "scope", "contractValidUntil", "refreshCadence", "attribution"];
      const missing = required.filter((f) => !merged[f]);
      if (missing.length) {
        throw new DataSourceError(422, "42280", `授权要件不完整，禁止开启：${missing.join("、")}（Q6 门）`);
      }
      if (merged.contractValidUntil && new Date(merged.contractValidUntil) <= new Date()) {
        throw new DataSourceError(422, "42281", "授权合同期已过，禁止开启");
      }
    }
    Object.assign(rec, patch);
    return { ...rec };
  }

  /** 客户端状态：off 时只有维护态说明，不存在任何国别数据出口 */
  publicStatus(key: string) {
    const rec = this.require(key);
    if (rec.state !== "on" || (rec.contractValidUntil && new Date(rec.contractValidUntil) <= new Date())) {
      return {
        key,
        available: false,
        title: "数据服务维护中",
        body: "全球通行的签证要求与护照对比依赖官方授权数据源，当前尚未开放；请以目的地官方渠道为准。",
        pages: ["my_passport", "visa_check", "passport_compare"]
      };
    }
    return { key, available: true, attribution: rec.attribution, refreshCadence: rec.refreshCadence };
  }

  private require(key: string): DataSourceAuthorization {
    const rec = this.records.get(key);
    if (!rec) throw new DataSourceError(404, "40480", "数据源不存在");
    return rec;
  }
}

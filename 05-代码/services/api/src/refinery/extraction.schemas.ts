/* AI 数据工厂：抽取 Schema（移民包 P1，确定性规则母版）
 * 每个字段：两阶段（存在性 → 取值），值必须命中证据块。
 */

import type { DocType } from "./refinery.types.js";

export interface FieldSchema {
  key: string;
  label: string;
  kind: "text" | "date" | "money" | "list";
  required?: boolean;
  /** 存在性关键词（命中即认为字段存在） */
  presence: RegExp;
  /** 取值正则（第一个捕获组为值；list 类型按块收集） */
  value?: RegExp;
  /** 列表项匹配（list 类型） */
  item?: RegExp;
}

export interface DocExtractionSchema {
  docType: DocType;
  fields: FieldSchema[];
}

const DATE_RE = /(\d{4}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?)/;

export const IMMIGRATION_EXTRACTION: DocExtractionSchema[] = [
  {
    docType: "regulation",
    fields: [
      {
        key: "program_name", label: "项目/计划名称", kind: "text", required: true,
        presence: /(计划|项目|方案|法案|program|plan)/i,
        value: /名称[：:]\s*([^\n，。]{2,30})|([A-Za-z\u4e00-\u9fa50-9「」（）()\s]{2,24}?(?:计划|项目|方案|法案))/
      },
      {
        key: "jurisdiction", label: "发布机构/司法管辖区", kind: "text",
        presence: /(发布|颁布|主管|机构|政府|部门|ministry|government)/i,
        value: /(?:[由为：:])([A-Za-z\u4e00-\u9fa5]{2,20}?(?:政府|部门|委员会|局|部|ministry|government))/
      },
      {
        key: "effective_date", label: "生效日期", kind: "date",
        presence: /(生效|施行|实施|自.*起|effective)/i,
        value: DATE_RE
      },
      {
        key: "key_requirements", label: "关键要求", kind: "list",
        presence: /(要求|条件|资格|requirement|eligibility)/i,
        item: /^\s*(?:[-*•]\s+|\d+[.、]\s*)(.{4,80})/
      }
    ]
  },
  {
    docType: "fee_schedule",
    fields: [
      {
        key: "platform_service_fee", label: "平台服务费", kind: "money",
        presence: /平台服务费|platform\s+(service\s+)?fee/i,
        value: /(?:平台服务费|platform\s+(?:service\s+)?fee)[^。\n]*?(?:(人民币|美元|欧元|CNY|USD|EUR)\s*)?([\d,]+(?:\.\d+)?(?:万)?)/i
      },
      {
        key: "official_fee", label: "官方费", kind: "money",
        presence: /官方费|government\s+fee|official\s+fee/i,
        value: /(?:官方费|government\s+fee|official\s+fee)[^。\n]*?(?:(人民币|美元|欧元|CNY|USD|EUR)\s*)?([\d,]+(?:\.\d+)?(?:万)?)/i
      },
      {
        key: "third_party_fee", label: "第三方/境外服务费", kind: "money",
        presence: /(律师费|境外.*费|第三方|third.party|legal\s+fee)/i,
        value: /(律师费|境外[^。\n]{0,10}费|第三方[^。\n]{0,6}费|third.party[^。\n]{0,14}fee)[^。\n]*?(?:(人民币|美元|欧元|CNY|USD|EUR)\s*)?([\d,]+(?:\.\d+)?(?:万)?)/i
      }
    ]
  },
  {
    docType: "project_doc",
    fields: [
      {
        key: "program_name", label: "项目名称", kind: "text", required: true,
        presence: /(项目|计划|program)/i,
        value: /名称[：:]\s*([^\n，。]{2,30})|([A-Za-z\u4e00-\u9fa50-9「」（）()\s]{2,24}?(?:项目|计划))/
      },
      {
        key: "processing_time", label: "办理周期", kind: "text",
        presence: /(周期|时长|时间|个月|工作日|processing\s*time)/i,
        value: /([约大约预计]?\s*\d+\s*(?:-|至|到)?\s*\d*\s*(?:个)?(?:月|工作日|周|天))/
      },
      {
        key: "residency_requirement", label: "居住要求", kind: "text",
        presence: /(居住|居留|登录|residency)/i,
        value: /居住要求[：:\s]+([^。\n]{2,40})/
      },
      {
        key: "eligibility", label: "适用/资格条件", kind: "list",
        presence: /(条件|资格|适用|eligibility)/i,
        item: /^\s*(?:[-*•]\s+|\d+[.、]\s*)(.{4,80})/
      }
    ]
  },
  {
    docType: "contract",
    fields: [
      {
        key: "party_a", label: "甲方", kind: "text", required: true,
        presence: /甲方/,
        value: /甲方[：:\s]*([^\s，。\n]{2,30})/
      },
      {
        key: "party_b", label: "乙方", kind: "text", required: true,
        presence: /乙方/,
        value: /乙方[：:\s]*([^\s，。\n]{2,30})/
      },
      {
        key: "sign_date", label: "签署日期", kind: "date",
        presence: /(签署|签订).*日期|日期.*(签署|签订)/,
        value: DATE_RE
      }
    ]
  }
];

/** 通用兜底字段（所有类型都尝试） */
export const GENERIC_FIELDS: FieldSchema[] = [
  {
    key: "any_date", label: "文中日期", kind: "date",
    presence: /\d{4}\s*[年/.-]\s*\d{1,2}/,
    value: DATE_RE
  },
  {
    key: "any_money", label: "文中金额", kind: "money",
    presence: /(人民币|美元|欧元|CNY|USD|EUR)\s*[\d,]+|[\d,]+(?:万)?\s*(?:元|美元|欧元)/,
    value: /(人民币|美元|欧元|CNY|USD|EUR)?\s*([\d,]+(?:\.\d+)?(?:万)?)\s*(元|美元|欧元)?/
  }
];

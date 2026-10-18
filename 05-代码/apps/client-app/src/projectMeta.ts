// 真实在售项目的展示元数据（公众浏览用）。
// 所有金额/周期/身份类型均取自已发布费表与项目资料（real_seed_data 对应文件），
// 不添加成功率、获批承诺；区域渐变沿用品牌莓红→海军蓝体系。

export interface ProjectMeta {
  /** 区域名（中文） */
  region: string;
  /** 国家/地区 */
  country: string;
  /** 身份类型：护照 / 永久居留 / 长期签证 / 工作准证 */
  kind: string;
  /** 核心投入门槛（一句话锚点，已发布费表口径） */
  anchor: string;
  /** 亮点标签（周期、随行、通行、居住等，仅写资料可证实的事实） */
  chips: string[];
  /** 卡片头图渐变（区域色） */
  gradient: [string, string];
  /** 一句话卖点（无承诺） */
  tagline: string;
}

// 区域渐变（同一品牌体系，按区域冷暖分组）
const G_CARIB: [string, string] = ["#0EA5A4", "#002661"]; // 加勒比·海绿→海军蓝
const G_OCEAN: [string, string] = ["#1E88B5", "#002661"]; // 大洋洲·海蓝
const G_EU: [string, string] = ["#AF2D67", "#002661"];    // 欧洲·品牌签名渐变
const G_AM: [string, string] = ["#C2410C", "#002661"];    // 美洲·琥珀→海军蓝
const G_ASIA: [string, string] = ["#7C3AED", "#002661"];  // 亚洲·紫→海军蓝
const G_AF: [string, string] = ["#0F766E", "#1A2B4A"];    // 非洲·墨青

export const PROJECT_META: Record<string, ProjectMeta> = {
  "PROJ-ATG-NDF": {
    region: "加勒比", country: "安提瓜和巴布达", kind: "护照（投资入籍）",
    anchor: "国家发展基金捐款 23 万美元起",
    chips: ["英联邦护照", "单人示例约 26.38 万美元", "约 3–6 个月", "全家可随行"],
    gradient: G_CARIB,
    tagline: "加勒比老牌投资入籍，NDF 捐款路径清晰、费用全分项。",
  },
  "PROJ-LCA-CBI": {
    region: "加勒比", country: "圣卢西亚", kind: "护照（投资入籍）",
    anchor: "基建投资 25 万美元起（4 人内家庭）",
    chips: ["英联邦护照", "单人约 26.97 万美元", "英语国家", "无居住要求"],
    gradient: G_CARIB,
    tagline: "东加勒比英语国家，基建投资入籍，家庭档位透明。",
  },
  "PROJ-GRD-CBI": {
    region: "加勒比", country: "格林纳达", kind: "护照（投资入籍）",
    anchor: "国家旅游度假区投资 27 万美元",
    chips: ["英联邦护照", "可衔接美国 E-2 签证", "单人估算约 34 万美元", "无居住要求"],
    gradient: G_CARIB,
    tagline: "唯一可衔接美国 E-2 条约的加勒比投资入籍项目。",
  },
  "PROJ-MSR-UK": {
    region: "加勒比", country: "蒙特塞拉特 → 英国", kind: "护照（两阶段）",
    anchor: "整体预算 550 万英镑",
    chips: ["BOTC 身份→英国护照", "地热能源工程", "规划约 12–18 个月", "服务费不成功不付尾期"],
    gradient: G_CARIB,
    tagline: "英国海外领地特殊贡献身份，两阶段衔接英国公民。",
  },
  "PROJ-VUT-DSP": {
    region: "大洋洲", country: "瓦努阿图", kind: "护照（投资入籍）",
    anchor: "政府捐赠 8 万美元起（单人）",
    chips: ["周期短", "无居住要求", "全家套餐", "南太平洋英联邦"],
    gradient: G_OCEAN,
    tagline: "南太平洋快速入籍，单人/夫妻/家庭套餐明码标价。",
  },
  "PROJ-FJI-RET": {
    region: "大洋洲", country: "斐济", kind: "退休移民签证",
    anchor: "服务费 6 万元人民币（一家三口）",
    chips: ["验资 10 万斐币存本人账户", "非收费", "可携子女父母", "每 3 年续签"],
    gradient: G_OCEAN,
    tagline: "面向退休养老与家庭移居，验资款为本人存款非收费。",
  },
  "PROJ-STP-CBI": {
    region: "非洲", country: "圣多美和普林西比", kind: "护照（投资入籍）",
    anchor: "国家转型基金捐款 9 万美元起",
    chips: ["先审批后捐款", "约 2–3 个月", "无需面试/登陆/居住", "葡语国家"],
    gradient: G_AF,
    tagline: "先审批后捐款，周期短、无登陆与居住要求。",
  },
  "PROJ-MLT-MPRP": {
    region: "欧洲", country: "马耳他", kind: "永久居留（MPRP）",
    anchor: "租房路径示例约 14.57 万欧元",
    chips: ["欧盟永久居留", "一家三代随行", "租房/购房可选", "申根通行"],
    gradient: G_EU,
    tagline: "欧盟永居，租房或购房两档，一家三代可随行。",
  },
  "PROJ-HUN-FUND": {
    region: "欧洲", country: "匈牙利", kind: "访客投资者居留",
    anchor: "认购合规基金 25 万欧元起",
    chips: ["2024 新居留法", "MNB 注册基金", "申根通行", "一家可随行"],
    gradient: G_EU,
    tagline: "依据 2024 新居留法，认购匈牙利国家银行注册基金份额。",
  },
  "PROJ-HUN-BLUE": {
    region: "欧洲", country: "匈牙利", kind: "欧盟蓝卡",
    anchor: "项目发行费 5.5 万欧元",
    chips: ["欧盟工作许可", "住满 3 年可申永居", "可家庭团聚", "丹麦/爱尔兰除外"],
    gradient: G_EU,
    tagline: "在匈合规就业取得欧盟蓝卡，住满年限衔接永居。",
  },
  "PROJ-GRC-GV": {
    region: "欧洲", country: "希腊", kind: "黄金居留",
    anchor: "购房 25 万欧元起（示例总预算约 26.9 万）",
    chips: ["购房即居留", "无语言学历要求", "一家三代随行", "申根 29 国通行"],
    gradient: G_EU,
    tagline: "欧洲低门槛购房黄金居留，税杂费逐项公开。",
  },
  "PROJ-ESP-DNV": {
    region: "欧洲", country: "西班牙", kind: "数字游民签证",
    anchor: "地接服务费 1,000 欧元/家庭",
    chips: ["远程工作/自由职业", "可携家属", "申根居留", "费用按实分项"],
    gradient: G_EU,
    tagline: "面向远程工作者、自由职业者与企业家，合法在西生活工作。",
  },
  "PROJ-PRT-GV": {
    region: "欧洲", country: "葡萄牙", kind: "黄金居留（基金路径）",
    anchor: "认购合规基金参考 50 万欧元",
    chips: ["无需购房", "无持有维护成本", "无强制长居", "欧盟居留"],
    gradient: G_EU,
    tagline: "基金路径取得黄金居留，免去购房持有与维护。",
  },
  "PROJ-SVN-CIT": {
    region: "欧洲", country: "斯洛文尼亚", kind: "护照（特殊贡献入籍）",
    anchor: "整体预算 300 万欧元",
    chips: ["欧盟护照", "绕过常规居留年限", "约 10–12 个月", "需三次登陆"],
    gradient: G_EU,
    tagline: "依《国籍法》特殊利益条款直接授予公民身份，服务费尾期与成功挂钩。",
  },
  "PROJ-PAN-PR": {
    region: "美洲", country: "巴拿马", kind: "永久居留（购房）",
    anchor: "购置 30 万美元以上房产",
    chips: ["722 号法案", "直接申请永居", "全家可随行", "税费分项公开"],
    gradient: G_AM,
    tagline: "依 722 号法案购房即申请永久居留，政府费逐项列明。",
  },
  "PROJ-USA-EB1A": {
    region: "美洲", country: "美国", kind: "职业移民（EB-1A）",
    anchor: "费用按个案评估",
    chips: ["杰出人才", "无雇主担保", "十项标准满足三项", "职业移民第一优先"],
    gradient: G_AM,
    tagline: "面向科学、艺术、教育、商业、体育杰出人才，无雇主担保可申请。",
  },
  "PROJ-ARE-INV": {
    region: "亚洲", country: "阿联酋", kind: "投资人居留（老板签）",
    anchor: "费用以正式方案为准",
    chips: ["设立公司", "取得 EID", "可银行开户", "企业出海起点"],
    gradient: G_ASIA,
    tagline: "当地设立公司取得投资人居留，适合企业出海与资产配置。",
  },
  "PROJ-SGP-EP": {
    region: "亚洲", country: "新加坡", kind: "自雇 EP 就业准证",
    anchor: "费用以正式方案为准",
    chips: ["首签 2 年续签 3 年", "可携全家", "属地征税", "可衔接 PR"],
    gradient: G_ASIA,
    tagline: "自雇开公司、自任高管取得 EP，满足条件后可申请 PR。",
  },
  "PROJ-THA-PE": {
    region: "亚洲", country: "泰国", kind: "精英签证（Privilege）",
    anchor: "会员费 90 万泰铢起（5 年）",
    chips: ["5/10/15/20 年多档", "机场快速通道", "贵宾厅特权", "长居多次往返"],
    gradient: G_ASIA,
    tagline: "长期特权签证，机场快速通道与贵宾厅，多档年限可选。",
  },
  "PROJ-KOR-DEP": {
    region: "亚洲", country: "韩国", kind: "存款移民",
    anchor: "存款按年龄/家庭分档",
    chips: ["存款到期可返还", "距中国飞行约 1–3 小时", "华人社群成熟", "可衔接长期居留"],
    gradient: G_ASIA,
    tagline: "向指定银行存款取得居留，存款到期可返还。",
  },
  "PROJ-JPN-BM": {
    region: "亚洲", country: "日本", kind: "经营管理/高度人才签证",
    anchor: "资本金 3,000 万日元（本人经营资金）",
    chips: ["成立公司", "可携配偶子女", "高度人才更快永住", "资本金非办理费"],
    gradient: G_ASIA,
    tagline: "在日成立公司取得经营管理签证，或走高度人才积分路径。",
  },
};

export const metaOf = (code: string): ProjectMeta | undefined => PROJECT_META[code];

/** 区域分组（展示顺序） */
export const REGION_ORDER = ["加勒比", "大洋洲", "欧洲", "美洲", "亚洲", "非洲"];

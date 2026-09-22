/**
 * 品牌与动效 token（与 04-UI设计/design 设计系统 v1.1、Web 端 tailwind.config 同源）
 * RN 侧唯一真源；修改需同步设计系统文档。
 */
export const colors = {
  navy: "#002661",
  navyHover: "#1E3E78",
  navy50: "#EDF1F8",
  navy100: "#DCE4F2",
  navyBtnTop: "#0B3A82",
  berry: "#AF2D67",
  berryLight: "#C63D80",
  berryDark: "#A5275F",
  berry50: "#FAEEF4",
  ink: "#1B2433",
  mut: "#5E6B7E",
  faint: "#8A95A6",
  line: "#E5E9F0",
  lineSoft: "#F0F3F8",
  paper: "#F5F7FA",
  white: "#FFFFFF",
  ok: "#177A5B",
  okBg: "#E6F4EE",
  warn: "#B45309",
  warnBg: "#FBF1E2",
  bad: "#C03221",
  badBg: "#FCEBEA",
  info: "#1D5F8A",
  infoBg: "#E9F2F8",
  purple: "#6B5AA8",
  purpleBg: "#EFECF7"
} as const;

/** 签名渐变：莓红 → 紫 → 海军蓝（对角，背景尺寸 170% 缓慢漂移） */
export const signatureGradient = ["#AF2D67", "#5E246B", "#002661"] as const;
export const navyButtonGradient = ["#0B3A82", "#002661"] as const;
export const berryButtonGradient = ["#C63D80", "#A5275F"] as const;

export const radius = {
  control: 12,
  card: 18,
  adminCard: 15,
  button: 22,
  phone: 42
} as const;

/** v1.3 动效契约（G-P6） */
export const motion = {
  /** 页面推进：420ms cubic-bezier(.22,1,.36,1) + 0.985→1 缩放 */
  screenDuration: 420,
  screenEasing: [0.22, 1, 0.36, 1] as const,
  screenEnterStartScale: 0.985,
  /** 内容分层入场：上移 14px，每级 +40ms，最多 10 级 */
  riseDistance: 14,
  riseStep: 40,
  riseMaxLevel: 10,
  /** 弹性（Tab 胶囊、开关、分段控件）cubic-bezier(.34,1.3,.5,1) 映射 spring */
  spring: { damping: 17, stiffness: 180, mass: 1 },
  /** 主按钮按压缩放 */
  pressScale: 0.96
} as const;

export const spacing = (n: number) => n * 4;

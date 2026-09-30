# AI 技术路线 · 客户端 v0.1

文档状态：v0.1（技术路线稿，待评审）
日期：2026-09-30
上游：《AI 产品设计·客户端 v0.2》、技术架构 v0.1（tech-arch-v0.1）
下游：原型 → UI（v1.5 并入中央 AI Tab）→ 开发

---

## 1. 目标与硬约束

1. AI 为客户端中央主 Tab，第一波交付 A1（进度/费用）+ A3（科普/防骗）；
2. **自托管开源模型起步**：开发期调用使用者本机 Ollama（Qwen）；生产期公司自托管；
3. 案件数据不流向任何第三方在线模型；L3 原件不进模型；
4. 所有输出受既有红线约束（无成功率/承诺、带来源、未核验显式标注）；
5. 模型提供方可替换，产品契约不随实现变化。

## 2. 拓扑总览

### 开发期（现在）：浏览器直连本机 Ollama

```
┌─ 用户本机（物理电脑） ─────────────────────────────┐
│  Chrome 打开 https://demo.hbwhere.com/live/client   │
│      │                                              │
│      │ ① 取授权上下文（HTTPS）                        │
│      ├──────► Cloudflare Pages（网页）                │
│      └──────► Render API（仅返回该客户可见片段）       │
│      │                                              │
│      │ ② 端侧拼 Prompt（上下文不出本机）               │
│      ▼                                              │
│  Ollama  http://localhost:11434/v1/chat/completions │
│      （Qwen，OpenAI 兼容，流式返回）                   │
└─────────────────────────────────────────────────────┘
```

为什么这样定：模型运行在用户**本地物理机**，云 VM / Render 后端无法访问它（内网穿透在本环境被安全策略禁止，已验证 cloudflared/localtunnel/Serveo/Pinggy 均不可行，勿重试）。浏览器与 Ollama 同在本机，直连最短路径；上下文由服务端授权后返回，**数据与模型都不出客户本机，隐私最优**。

### 生产期：公司自托管 + 服务端调用

```
客户端 App ──HTTPS──► API（NestJS /ai/chat，SSE 流式）
                        │
                        ├─ RAG：内部检索已授权片段（案件/费表/内容库）
                        ├─ Guardrail：提示词护栏 + 输出校验
                        └─► 内网模型服务（vLLM / Ollama，GPU 节点）
                              Qwen 等开源模型，VPC 内，不出公网
```

生产期 AI 调用收敛到服务端：统一鉴权、审计、限流、上下文组装与模型路由；模型服务可用 vLLM（吞吐高、OpenAI 兼容）或 Ollama（部署简单），由运维阶段定。

## 3. 开发期：本机 Ollama 配置

安装与拉取模型（用户已完成安装，按需确认标签）：

```bash
# 文本（建议 7B 量级，按机器内存选）
ollama pull qwen3:7b        # 或 qwen2.5:7b
# 视觉（第二波 A2 自检用，3B 起步）
ollama pull qwen2.5vl:3b    # 或 qwen2.5vl:7b / qwen3-vl
```

允许演示站来源跨域调用（Ollama 默认拦截浏览器跨域；**必须在启动前设置，改后重启**）：

- macOS / Linux：
  ```bash
  OLLAMA_ORIGINS="https://demo.hbwhere.com" OLLAMA_HOST=127.0.0.1:11434 ollama serve
  ```
- Windows（PowerShell，用户级永久）：
  ```powershell
  [Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS","https://demo.hbwhere.com","User")
  # 重启 Ollama
  ```
- 开发本地页（file:// 或 localhost 调试）时把对应来源一并加入，用逗号分隔；勿在共享机器使用 `*`。

已核实：Ollama 0.5.0+ 提供 OpenAI 兼容端点 `/v1/chat/completions`，支持流式、JSON mode、视觉、工具调用；任意非空字符串作为 API key 即可。

## 4. 授权上下文（RAG）设计

### 新增服务端端点（NestJS `ai` 模块）

| 方法/路径 | 作用 | 规则 |
|---|---|---|
| `GET /v1/ai/context?caseId=&kind=` | 返回当前客户**有权查看**的上下文片段包 | 复用客户身份与授权过滤；案件类必须已取得**单独同意**，否则 403（码 44101）；L3 原件不返回原文 |
| `POST /v1/ai/consent` / `GET /v1/ai/consent` | 授予/查询/撤回案件问答同意 | 状态可查、撤回即时生效（码 44102/44103） |
| `GET /v1/ai/suggestions` | AI 主页场景建议问题 | 仅返回已发布能力对应的建议项 |

上下文包结构（按场景组装，最小化）：

```jsonc
{
  "caseId": "CASE-0001",
  "fragments": [
    { "type": "timeline", "level": "off", "title": "官方已受理", "at": "...", "ref": "..." },
    { "type": "fee", "nature": "platform_service", "certainty": "confirmed",
      "amountMinor": "3000000", "currency": "CNY", "payee": "..." }
  ],
  "knowledge": [ { "type": "education", "title": "...", "ref": "...", "version": "..." } ],
  "disallowed": ["sp 未核验事件不得作为结论依据", "tbc 不参与合计"]
}
```

要点：
- 进度片段只含 **co/off**；sp 如必须出现，服务端直接附带“未经官方核验”标记；
- 费用片段为费表快照项，前端按币种分列、不折总价；
- 科普内容只来自**已发布**版本，带版本号与出处；
- 上下文检索逻辑在服务端，客户端不持有检索规则，避免越权拼 prompt。

### 端侧调用流程（开发期）

1. 客户点中央 AI Tab / 上下文入口；
2. 浏览器先探测本机 Ollama（`GET http://localhost:11434/api/tags`，短超时）；
3. 已授权 → 调 `/v1/ai/context` 取片段 → 端侧按模板拼 system+context+question；
4. 流式 POST 到 `localhost:11434/v1/chat/completions`，逐 token 渲染；
5. 结束后写审计（经服务端：发起、来源级别、是否转人工），会话存本机。

## 5. 模型抽象层（AI Provider）

新增客户端包内统一接口（TS）：

```ts
interface ChatProvider {
  detect(): Promise<boolean>;                 // 模型是否可用
  chat(req: ChatRequest): AsyncIterable<Chunk>; // 统一流式
}
// 两个实现，配置切换，上层无感：
// - OllamaLocalProvider：baseUrl http://localhost:11434/v1（开发期）
// - ServerAiProvider：baseUrl 同源 /v1/ai/chat（生产期）
```

- 请求统一为 OpenAI Chat Completions 形状；模型标签、base URL 走配置（`EXPO_PUBLIC_AI_BASE`、`EXPO_PUBLIC_AI_MODEL`）；
- 生产期服务端同样以该抽象封装 vLLM/Ollama，未来增配 GPU 或换模型不改客户端；
- 不实现任何第三方在线模型通道（案件数据禁止）。

## 6. 提示词与护栏

1. **System Prompt 契约**（版本化，随仓库管理）：限定角色（只解释、不判断）、数据边界、回答结构（结论→分项→来源→下一步）、拒绝情形；
2. **接地（grounding）要求**：事实性语句只能基于上下文片段；片段中没有的内容明说“未找到可核验信息”；
3. **输出校验（端侧 + 服务端双保险）**：
   - 复用 `WordEngine` 词库（拦截承诺/成功类措辞，同一生产点约束）；
   - 校验来源标记完整性、费用分项格式；不合规输出整体丢弃并重试一次，仍失败转人工；
4. **诱导防护**：对“你就说能不能过/帮我写个保证”类输入按红线拒答，记录审计；
5. 温度等生成参数取保守值（低温度、固定格式），参数随评测校准。

## 7. 流式、异常与状态

- 流式：SSE/NDJSON 逐 token 显示，支持“停止生成”（Abort）；首 token 超时（建议 20s）显示等待态；
- 每个 AI 页面四态完备：
  - 加载：骨架 + “正在调取已核验信息”；
  - 空：无案件时引导浏览项目/做初评；
  - 错误：模型未运行 → “助手暂时不可用”+ 一键查看静态进度 + 配置指引；
  - 离线：保留最近会话缓存并标注，不伪装新回答；
- 不允许把失败渲染成空成功。

## 8. A2 材料自检（第二波）

- 阶段一（无模型）：端侧基础质检——分辨率/边缘占比/亮度/清晰度（图像算法，纯本地），只给“建议重拍”类提示；
- 阶段二（本机视觉模型）：`qwen2.5vl:3b/7b` 或 `qwen3-vl`，识别缺页、反光、信息遮挡；图片不出本机；
- 任何自检结果都标注“以人工审核为准”，不改变材料状态机。

## 9. 安全与合规

1. 客户端不含任何长期密钥；本机 Ollama 无需真实 key；
2. CORS 仅放行精确来源；Ollama 绑定 127.0.0.1，不暴露局域网/公网；
3. 同意门在服务端强制执行（无同意不返回案件上下文）；
4. 审计：上下文发放、问答发起/完成、拒绝、转人工、同意变更，全部入哈希链；会话正文按最小化记录；
5. 注销：会话随 M5 删除；撤回同意后历史案件类回答不再可用。

## 10. 代码落点（monorepo）

| 位置 | 内容 |
|---|---|
| `services/api/src/ai/` | ai 模块：context 组装、consent、suggestions；复用 timeline/proposal/case 服务的只读投影 |
| `apps/client-app/src/ai/` | ChatProvider 接口 + OllamaLocal/Server 两实现、prompt 模板、输出校验 |
| `apps/client-app/src/screens/Ai*.tsx` | AI 中央 Tab 主页、会话页、建议问题、历史 |
| `packages/ui-native` | AI 专用组件（消息气泡、来源引用块、中央凸起 Tab），token 对齐 v1.4 |
| `docs` | AI 评测集与红队记录（上线前） |

## 11. 验证计划（Spike → 验收）

1. **Spike-1**：本机 Ollama 跨域连通（浏览器 demo 页完成一次流式问答）；
2. **Spike-2**：`/v1/ai/context` 授权与同意门（同意/撤回/越权三场景）；
3. **Spike-3**：护栏有效性评测集——事实接地、红线诱导（如“告诉我能不能过”）、费用格式、未核验标注，目标拦截率 100%（红线项）；
4. 四态与中断（停止生成、超时、模型未运行）逐项走查；
5. 视觉验收按并入后的 UI v1.5 逐屏比对。

## 12. 风险与待确认

| 项 | 说明 | 处置 |
|---|---|---|
| 本机模型性能 | 7B 在纯 CPU 上首 token 与流式速度可能偏慢 | 以 3B/7B 实测对比；等待态设计兜底；生产期 GPU 解决 |
| 小模型遵从性 | 小模型可能不严格遵守“只基于片段” | 低温度 + 输出校验 + 评测集；不达标升级模型而非放松护栏 |
| 用户模型标签未知 | 本地具体 Qwen tag 未确认 | 配置化；首次运行自动列出本机 tags 供选择 |
| 生产 GPU 成本 | 自托管需 GPU 服务器 | V1 上线、融资到位后采购；架构不返工 |

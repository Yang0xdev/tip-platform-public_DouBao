# AI 知识工程技术路径分析：从 RAG 到 GraphRAG、Agentic RAG 与 LLM Wiki

文档状态：v0.1（技术研究与选型建议）
日期：2026-10-01
约束基线：自托管 Ollama + Qwen（本地物理机）；三端 AI（客户/顾问/总后台）；
所有回答必须带来源、不做结果承诺；L3 原件不进模型；知识发布走四眼。

---

## 1. 五种主流路径速览

| 路径 | 知识何时被“理解” | 强在 | 弱在 | 成本 |
|---|---|---|---|---|
| **向量 RAG（naive/advanced）** | 查询时临时检索片段 | 单文档事实问答、FAQ、政策条文定位 | 多跳推理、全局总结；知识不沉淀 | 低 |
| **微软 GraphRAG** | 索引时一次性抽取实体关系图 + 社区摘要 | 全局性/战略性问题、跨文档多跳 | 索引 token 成本极高；更新需重建社区 | 高 |
| **LightRAG（港大）** | 每插入一份文档增量建子图；查询走有界邻域，双层（局部/全局）检索 | 多跳 + 比较，成本低、可增量，笔记本可跑 | 图谱质量决定上限；抽取对模型能力有要求 | 低-中 |
| **Agentic RAG** | Agent 自主规划、调工具、多轮迭代检索 | 准确率/解决复杂问题能力最高 | 延迟高、链路长、可控性挑战 | 中-高（延迟） |
| **LLM Wiki（Karpathy）** | 先把资料“编译”为 LLM 维护的 Markdown 页面，再在页面上工作 | 知识沉淀复利、可审计、可交叉引用、冲突显性化 | 错误会被一起沉淀，需人工核查层 | 低 |

行业实测（公开基准，仅供参考）：向量 RAG 单跳事实约 70–85%，多跳/全局降到 40–55%；
GraphRAG 全局总结可达 80–92%；Agentic GraphRAG 在多文档基准上比纯 RAG 高约 2 倍。
结论性共识：**它们不是互斥替代，而是按问题类型路由的不同后端。**

## 2. LLM Wiki 机制详解（用户重点关注）

Karpathy 2026 年提出，核心比喻：Obsidian 像 IDE，LLM 像程序员，wiki 像代码库。

**三层结构**
1. `raw/` 原始资料（PDF、网页、笔记、数据）——**不可变，唯一事实来源**；
2. `wiki/` LLM 维护的 Markdown：来源摘要页、实体页、概念页、对比分析、主题总览，
   页间用 `[[wiki-links]]` 交叉引用；
3. `schema.md`（CLAUDE.md/AGENTS.md）——规定如何摄取、链接、检查的规则。

**三个循环动作**
- **Ingest**：一次处理一份新资料 → 摘要页、更新 index 与相关实体/概念页、记 log；
- **Query**：先查 wiki 相关页再综合；回答可回写成页面/对比表/图表，让提问结果也沉淀；
- **Lint**：定期健康检查——页面冲突、旧结论被推翻、孤立页、缺失概念页、缺交叉引用、待补资料。
`index.md`（内容目录）+ `log.md`（时间日志）是长期可维护的关键；
约 100 个来源、几百页面规模下，甚至不必上向量检索。

**两个已知风险（与我们高度相关）**
1. 知识整理会放大事实错误 → 必须补：事实核查层、可信度标记、引文约束、高风险页人工 review；
2. 延伸方向：wiki 可进一步整理为结构化数据用于微调（长期议题，本期不做）。

## 3. 我们平台的特殊要求（选型约束）

1. 业务是高合规的移民服务：错一句“能办/包过”就是合规事故——**精度优先于花哨**；
2. 每条答案必须可溯源（co/off 分级），来源失效要联动下架；
3. 已有四眼发布与版本化机制，知识层应**复用而非另起炉灶**；
4. 核心问题类型：政策/费用事实定位（单跳）、项目与客户画像匹配（多跳+比较）、
   综合诉求方案（跨项目组合）、全局进展/知识总结；
5. 语料初期不大（项目政策、费表、模板、教育文章），运行在 Qwen 7B 级本地模型。

## 4. 推荐方案：混合“知识编译层（Compiled Knowledge Layer）”

不是五选一，而是**以 LLM Wiki 为主体、LightRAG 图谱为多跳/比较后端、向量索引按需补、轻 Agent 路由**。

```
Layer 0  raw/ 不可变原件（现有文档存储；L3 独立桶、不进模型）
Layer 1  Wiki 编译页（Markdown：项目/概念/实体/对比/总览，frontmatter 含来源、级别、版本、复核人）
Layer 2  轻量图谱（LightRAG 式增量：国家/项目/要求/客户情境节点与关系）
Layer 3  向量索引（语料增长后补，单事实定位；小规模先不建）
查询     轻 Agent 路由：事实→Wiki/向量；匹配/比较→图谱；全局→主题页（未来社区摘要）
护栏     四眼发布 + Lint 一致性检查 + 来源失效联动下架 + 引用强制
```

**为什么这样选**
- LLM Wiki 与我们四眼发布天然同构：Markdown 可审计、可版本化、直接进 Gitee；
  总后台「知识与运营中心」就是编译器的操作台；
- LightRAG 增量、低成本、笔记本可跑，支撑客户端「项目比较/需求访谈」与顾问「综合诉求方案」；
- 不采用完整微软 GraphRAG：索引成本高、更新重建、7B 模型抽取性价比不足；
- 不采用纯向量 RAG：知识不沉淀，且多跳比较正是产品核心；
- Agentic 仅用于查询路由（轻量、可枚举），不开放不可控长链。

## 5. 分阶段落地

| 阶段 | 内容 | 服务于 |
|---|---|---|
| K1 | **Wiki 编译器**：ingest 一份资料 → 生成/更新 Wiki 草稿页 + index/log → 人工四眼 → 发布；定时 Lint | 总后台知识中心；三端事实问答 |
| K2 | **LightRAG 式图谱**：增量抽取项目/要求/情境关系；支撑匹配与比较查询 | 客户端访谈/比较、顾问综合方案 |
| K3 | 向量索引 + 路由完善（语料达阈值后）；在线模型仅作难任务可选开关，默认关 | 全平台检索质量 |

## 6. 工程要点

1. Wiki 页 frontmatter 统一 schema：`sources[]、level(co/off)、projectCode、version、reviewer、status`；
2. 抽取与编译全部走结构化 schema（JSON mode），降低 7B 模型格式漂移；
3. 文档与指令物理分隔（防文档内提示注入）；文档只作被引用数据；
4. 用 MCP（Model Context Protocol）风格封装工具/上下文接口，便于未来替换后端；
5. Lint 结果与现有「失效联动」「知识缺口」模块打通；
6. 编译动作（生成/复核/发布/驳回/下架）全部入哈希链。

## 7. 待决策（不阻塞 K1）

1. Wiki 页是否对客户直接可见（建议：仅已发布教育/项目内容对客，内部概念页仅顾问/后台）；
2. K2 图谱抽取模型：先用本地 Qwen 7B 试跑评估，质量不足再考虑更大模型/在线开关；
3. 触发 Lint 的节奏（建议每日一次 + 每次 ingest 后增量检查）。

---

### 参考来源

- Karpathy「LLM Wiki」机制解读：https://cloud.tencent.com/developer/article/2653360
- llmwiki 知识编译器（raw→compile→wiki）：https://pypi.org/project/llmwiki/0.5.2/
- Graph RAG vs Agentic RAG vs Hybrid（架构与准确率）：https://kanopylabs.com/blog/graph-rag-vs-agentic-rag-vs-hybrid-rag-patterns
- RAG 架构选型（GraphRAG/混合为生产标准）：https://matthewkruczek.ai/blog/rag-taxonomy-enterprise
- LightRAG（增量建图、双层检索、低成本）：https://lightrag.github.io/ ；https://www.x-cmd.com/install/lightrag/
- RAGFlow（深度文档理解、集成 GraphRAG/RAPTOR/TOC）：https://ragflow.com.cn/docs/release_notes
- AWS：GraphRAG 与 LightRAG 统一栈：https://aws.amazon.com/blogs/opensource/unified-knowledge-graph-rag-on-aws-graphrag-and-lightrag-on-one-stack/
- LLMpedia：可审计的参数化百科生成框架：https://arxiv.org/pdf/2603.24080

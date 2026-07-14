# CLAUDE.md — 本仓库给 Claude / 开发会话的说明

在动手改代码或规划任务前，先读：

1. **[docs/FORK.md](./docs/FORK.md)** — fork 目的、remote、与上游同步、分支约定、实现索引  
2. **[docs/plans/2026-07-14-library-source-filter-design.md](./docs/plans/2026-07-14-library-source-filter-design.md)** — 已定稿的 Library 按来源管理设计  
3. **[docs/plans/2026-07-14-library-source-filter.md](./docs/plans/2026-07-14-library-source-filter.md)** — 分 Task 实现计划  

## 一句话目标

Fork of [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager) → [winlend/skills-manager](https://github.com/winlend/skills-manager)。  
在 **Library** 中按 **具体来源（source_key）** 筛选/分组，并批量更新与批量加入/移出 Preset；**不**新增左侧「来源」主导航页。

## Remotes

- `origin` = `winlend/skills-manager`（推送）  
- `upstream` = `xingkongliang/skills-manager`（吃官方更新）  

同步：`git fetch upstream` → `main` merge `upstream/main` → `push origin main` → feature 分支 merge `main`。详情见 `docs/FORK.md`。

## 实现约束（摘要）

- 优先改：`src/views/MySkills.tsx`、新建 `src/lib/skillSource.ts`、`MultiSelectToolbar`；复用现有 `batchUpdateSkills` / preset API。  
- 少动侧栏与无关模块，便于合 upstream。  
- 加入 Preset = 仅 membership，不自动 sync 到 Agent。  

## 当前分支

功能开发默认在：`feature/library-source-filter`。

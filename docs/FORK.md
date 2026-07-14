# Fork 说明与上游同步指引

> 本文档面向 **本仓库维护者与后续 AI 会话**。  
> 目的：说明为什么 fork、当前目标、与官方仓库的关系、如何安全同步。

**最后更新：** 2026-07-14  
**维护者 GitHub：** [winlend](https://github.com/winlend)  
**本 Fork：** https://github.com/winlend/skills-manager  
**上游官方：** https://github.com/xingkongliang/skills-manager  

---

## 1. 为什么 Fork

官方 **Skills Manager**（Tauri + React）是跨多 Agent 的技能库管理工具。本 fork **不是**另起炉灶，而是在跟进上游的前提下，做 **本地优先的功能增强**。

### 核心痛点（动机）

安装来源很多时（多个 Git 仓库、skills.sh 包、本地路径）：

1. **同一来源的 skill 在列表里散落**，难以一次看清。
2. **按具体来源批量更新**不方便（官方筛选偏「渠道」粒度：git / skills.sh / local，不够「某个 repo」）。
3. **把同一来源整批加入/移出 Preset** 往往只能逐个点。

相关上游反馈：[xingkongliang/skills-manager#300](https://github.com/xingkongliang/skills-manager/issues/300)（分组/筛选/按来源进 Preset 费劲）。

### 选定方案（已定稿）

**强化 Library（技能库）**，不新增左侧主导航页：

| 能力 | 说明 |
|------|------|
| 渠道筛选 | 保留/使用现有 `git` / `skillssh` / `local` / `import` |
| 具体来源 | `source_key`（如 `git:github.com/obra/superpowers`）筛选 + 下拉 |
| 按来源分组 | 默认开启分组视图 |
| 搜索 | 名称/描述 **+** 来源 label / URL / key |
| 批量 | 检查更新、全部更新、加入/移出指定 Preset |

详细设计与边界见：

- [设计](./plans/2026-07-14-library-source-filter-design.md)（已 Accepted）
- [实现计划](./plans/2026-07-14-library-source-filter.md)

### 明确不做（MVP）

- 左侧新开「来源」一级页面（后续若需要可做深链入口）
- 按来源自动创建 Preset
- 加入 Preset 时强制 sync 到 Agent（仅改 membership，与产品语义一致）
- Capability / 意图导航（上游 #301）

---

## 2. 仓库与 Remote 约定

| Remote | URL | 用途 |
|--------|-----|------|
| **origin** | `https://github.com/winlend/skills-manager.git` | 推送本 fork 的分支、PR 基线 |
| **upstream** | `https://github.com/xingkongliang/skills-manager.git` | 拉取官方新功能与修复 |

本地检查：

```bash
git remote -v
# origin    → winlend/skills-manager
# upstream  → xingkongliang/skills-manager
```

若缺少 remote：

```bash
git remote add origin https://github.com/winlend/skills-manager.git
git remote add upstream https://github.com/xingkongliang/skills-manager.git
```

### 分支习惯

| 分支 | 说明 |
|------|------|
| `main` | 跟踪官方默认分支；定期与 `upstream/main` 对齐后推送到 `origin/main` |
| `feature/*` | 功能开发（当前：`feature/library-source-filter`） |

**不要**在 `main` 上堆长期未合并的大改；功能在 feature 分支完成后再合入本 fork 的 `main`。

---

## 3. 日常开发流程

```bash
# 在功能分支上工作
git checkout feature/library-source-filter
# ... 改代码、提交 ...
git push -u origin HEAD
```

实现时优先：

1. 改动集中在 Library 筛选/列表/多选工具条（如 `src/views/MySkills.tsx`、`src/lib/skillSource.ts`、`MultiSelectToolbar`）。
2. **复用**已有 Tauri API：`batchUpdateSkills`、`checkSkillUpdate`、`addSkillToPreset`、`removeSkillFromPreset`。
3. 少动侧栏壳与无关模块，降低与上游的 merge 冲突。

---

## 4. 如何把上游新功能合进本 Fork

原则：**先更新 `main`，再把 `main` 合进功能分支**。

### 4.1 推荐：命令行 merge（稳妥）

```bash
# 1. 提交或 stash 当前工作
git status

# 2. 更新本地 main
git fetch upstream
git checkout main
git merge upstream/main
# 若有冲突：解决 → git add → git commit

# 3. 推送到自己的 fork
git push origin main

# 4. 功能分支吃进最新 main
git checkout feature/library-source-filter
git merge main
# 冲突解决后再继续开发
git push origin feature/library-source-filter
```

### 4.2 可选：rebase（历史更直，需 force-with-lease）

```bash
git checkout main
git fetch upstream
git rebase upstream/main
git push --force-with-lease origin main

git checkout feature/library-source-filter
git rebase main
git push --force-with-lease origin feature/library-source-filter
```

仅在 **个人 fork、无他人依赖该分支** 时使用 force-with-lease。

### 4.3 GitHub 网页

打开 https://github.com/winlend/skills-manager → **Sync fork** / **Update branch**（无冲突时最快）。  
同步后本地：

```bash
git checkout main
git pull origin main
```

### 4.4 建议频率

上游发布较勤（例如 v1.28.x）。建议：

- 每个官方 **release** 或至少 **每周** `fetch upstream` 一次；
- 不要攒数月再合，冲突会指数级变难。

---

## 5. 冲突与风险

| 风险 | 应对 |
|------|------|
| 与上游同时改 `MySkills.tsx` | 小步提交；冲突时优先保留上游结构，再挂回我们的 source_key UI |
| 误推到 upstream | 确认 `git remote -v`；**只 push origin** |
| 把 fork 独有提交弄丢 | merge 前 `git status` 干净；重要分支已 push 到 origin |
| 把「加入 Preset」做成自动启用 Agent | 违反设计；只改 preset membership |

---

## 6. 给后续会话的快速上下文

复制下面这段即可作为会话开场摘要：

```text
本仓库是 winlend fork 的 skills-manager（origin），upstream 为 xingkongliang/skills-manager。
目标：在 Library 中按具体来源（source_key）筛选/分组，并批量更新、批量加入/移出 Preset；
不新增左侧「来源」主导航。设计与计划见 docs/plans/2026-07-14-library-source-filter*.md。
同步上游：fetch upstream → merge 到 main → push origin → merge main 进 feature 分支。
当前功能分支：feature/library-source-filter。
```

### 关键路径索引

| 文档 | 路径 |
|------|------|
| 本说明 | `docs/FORK.md` |
| 产品设计（Accepted） | `docs/plans/2026-07-14-library-source-filter-design.md` |
| 实现计划（分 Task） | `docs/plans/2026-07-14-library-source-filter.md` |
| 个人打包 / 覆盖安装 | `docs/PERSONAL-BUILD.md` + `scripts/sync-and-build.ps1` |
| 官方 README | `README.md` / `README.zh-CN.md` |

### 实现时优先阅读的代码

| 区域 | 路径 |
|------|------|
| Library UI | `src/views/MySkills.tsx` |
| 前端 API / `ManagedSkill` | `src/lib/tauri.ts` |
| 多选工具条 | `src/components/MultiSelectToolbar.tsx` |
| 技能存储 | `src-tauri/src/core/skill_store.rs` |
| 更新 / 来源相关命令 | `src-tauri/src/commands/skills.rs` |
| Preset 成员 | `src-tauri/src/commands/presets.rs` |

**现状摘要（实现前）：**  
- 已有按 `source_type`（渠道）筛选，**无** 具体 repo 级 `source_key`。  
- 搜索仅名称/描述，**不含** `source_ref`。  
- 已有 `batchUpdateSkills`、单 skill 进出 Preset；多选工具条 **无**「加入任意 Preset」。

---

## 7. 环境与工具（本机记录）

- 项目路径：`F:\AI Works\Projects\skills-manager`
- GitHub CLI：`C:\Program Files\GitHub CLI\gh.exe`（Git Bash 中若无 `gh`，用该绝对路径）
- 登录账号：`winlend`
- 勿使用已废弃的旁路目录 `skills-manager-src`（若仍存在可删除，以本目录为准）

---

## 8. 变更日志（本 fork 文档层）

| 日期 | 事项 |
|------|------|
| 2026-07-14 | Fork 建立；remote origin/upstream；分支 `feature/library-source-filter`；设计与实现计划落盘；本文档创建 |

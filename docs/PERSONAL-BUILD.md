# 个人使用：同步上游 + 本地打包 + 旁路部署（不覆盖官方 exe）

> 脚本：[`scripts/sync-and-build.ps1`](../scripts/sync-and-build.ps1)

## 本机路径

| 项 | 路径 |
|----|------|
| 官方程序（**永不覆盖**） | `D:\Program Files\skills-manager\skills-manager.exe` |
| 你的 fork 副本（默认名） | `D:\Program Files\skills-manager\skills-manager-winlend.exe` |
| 用户数据（两边共用） | `%LOCALAPPDATA%\com.agentskills.desktop` |

同一 `identifier`，数据共享；两个 exe 可并存，用不同快捷方式启动。

---

## 一键用法

**默认会部署**（复制为旁路 `skills-manager-winlend.exe`）。不需要再写 `-Deploy`。

```powershell
cd "F:\AI Works\Projects\skills-manager"

# 同步（若有）+ 打包 + 部署 + 桌面快捷方式
.\scripts\sync-and-build.ps1 -CreateShortcut

# 自定义文件名
.\scripts\sync-and-build.ps1 -DeployName "skills-manager-fork.exe"

# 只同步 / 只打包不部署
.\scripts\sync-and-build.ps1 -SkipBuild
.\scripts\sync-and-build.ps1 -SkipSync -NoDeploy

# 同步 + 打包，但不复制到 InstallDir
.\scripts\sync-and-build.ps1 -NoDeploy
```

**拒绝**把 `-DeployName` 设为 `skills-manager.exe`，防止误覆盖官方。

覆盖 `Program Files` 时若无写权限：用**管理员** PowerShell。

---

## 上游有改动时

1. `git fetch upstream`  
2. 比较当前分支与 `upstream/main`  
   - **0 提交** → 跳过 merge  
   - **有提交** → 先 merge 进 `main`，再 merge 进当前功能分支  

### 发生冲突时（脚本行为）

| 脚本会做 | 脚本不会做 |
|----------|------------|
| **立即停止** | 自动选一边解决冲突 |
| 打印冲突文件指引 | 继续打包 / 部署 |
| 保留「合并进行中」状态 | 覆盖官方 `skills-manager.exe` |
| 提示 `git merge --abort` | 静默跳过冲突 |

**你自己处理：**

```text
# 查看
git status
git diff --name-only --diff-filter=U

# A) 解决后继续
#    编辑冲突文件，去掉 <<<<<<< ======= >>>>>>>
git add <文件>
git commit -m "chore: resolve merge with upstream"
.\scripts\sync-and-build.ps1

# B) 放弃这次合并
git merge --abort
```

**建议保留策略（本 fork）：**

- `src/views/MySkills.tsx` / `skillSource*` / `MultiSelectToolbar` / `PresetPickDialog`：优先保留 **你的来源筛选改动**，再手工并入上游相关修复  
- `docs/FORK.md`、`docs/plans/*`、`CLAUDE.md`：一般 **keep ours**  
- 与功能无关的上游 bugfix：倾向 **accept theirs** 再编译验证  

冲突未解决前**不要**强推 origin；解决并 commit 后再 push。

---

## 打包与部署

1. `npm run tauri:build:personal`（脚本会先写 `src-tauri/tauri.personal-build.conf.json`）：  
   - `createUpdaterArtifacts: false`  
   - 清空 `plugins.updater.pubkey`（避免索要 `TAURI_SIGNING_PRIVATE_KEY`）  
   - **勿**用 `npm run tauri -- build --config ...`：npm 会吞掉 `--config`，路径误传给 cargo  
2. 产物：`src-tauri\target\release\skills-manager.exe`  
3. **默认部署**：复制为  
   `D:\Program Files\skills-manager\skills-manager-winlend.exe`  
   （仅备份同名 **fork** 旧文件，不动官方 exe；`-NoDeploy` 可跳过）  
4. `-CreateShortcut`：桌面「Skills Manager (winlend)」  

**不要**对个人 fork 跑 `npm run tauri:build`（会走官方 conf，需要签名私钥）。

启动 fork：

```powershell
& "D:\Program Files\skills-manager\skills-manager-winlend.exe"
```

官方仍从开始菜单原快捷方式启动。

---

## 自动更新提醒

应用内更新仍可能指向官方 Release。个人用建议忽略更新提示，避免官方安装器覆盖目录；你的 `*-winlend.exe` 只要不被安装器删除即可（多数安装器只替换主 exe，但全量重装仍可能清目录——重装后重新跑一次脚本即可）。

---

## 常见问题

| 问题 | 处理 |
|------|------|
| 冲突后工作区乱七八糟 | `git merge --abort` 回到合并前 |
| Access denied 写 Program Files | 管理员运行；或 `-InstallDir` 改到你有权限的目录；或 `-NoDeploy` 只打包 |
| `TAURI_SIGNING_PRIVATE_KEY` | 用 `npm run tauri:build:personal`；勿用官方 `tauri:build`；确认 personal conf 存在且无 BOM |
| `unexpected argument '...personal-build.conf.json'` | 旧写法把 `--config` 传给了 npm。请拉最新脚本，用 `tauri:build:personal` |
| 脏工作区拒绝运行 | **仅当**「上游也有」的已跟踪文件有**真实 diff** 时拦截。未跟踪、fork 独有、以及 `status` 脏但 `diff` 为空（Windows CRLF 假脏，如 `Cargo.toml`）均可忽略 |
| 想回官方 | 直接运行官方 `skills-manager.exe`，不必删 fork 副本 |

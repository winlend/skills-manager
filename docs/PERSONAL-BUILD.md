# 个人使用：同步上游 + 本地打包 + 覆盖安装目录

> 适用：本机已安装官方 Skills Manager，想用 fork 改动版 exe 直接替换官方目录里的程序启动。  
> 脚本：[`scripts/sync-and-build.ps1`](../scripts/sync-and-build.ps1) / [`scripts/sync-and-build.cmd`](../scripts/sync-and-build.cmd)

## 本机安装位置（已探测）

| 项 | 路径 |
|----|------|
| 程序目录 | `D:\Program Files\skills-manager\` |
| 主程序 | `D:\Program Files\skills-manager\skills-manager.exe` |
| CLI | `D:\Program Files\skills-manager\skills-manager-cli.exe` |
| 开始菜单快捷方式 | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\skills-manager.lnk` |
| 用户数据（库/Preset 等） | `%LOCALAPPDATA%\com.agentskills.desktop` |

替换 **exe 不会清数据**（identifier 相同：`com.agentskills.desktop`）。

## 前置

1. **Rust**（`cargo` 在 PATH）+ **VS C++ 桌面生成工具**  
2. **Node.js** + 仓库已 `npm ci` 过一次  
3. 工作区 **干净**（无未提交改动），脚本会拒绝脏树 merge  
4. 覆盖 `D:\Program Files\...` 时用 **管理员** PowerShell

## 一键用法

在项目根目录：

```powershell
# 仅检查上游 + 有更新则 merge + 打包（不覆盖安装目录）
.\scripts\sync-and-build.ps1

# 打包并覆盖官方安装目录（推荐管理员运行）
.\scripts\sync-and-build.ps1 -Deploy

# 指定安装目录
.\scripts\sync-and-build.ps1 -Deploy -InstallDir "D:\Program Files\skills-manager"

# 只同步不打包 / 只打包不同步
.\scripts\sync-and-build.ps1 -SkipBuild
.\scripts\sync-and-build.ps1 -SkipSync -Deploy

# 演练（不真正 merge/build/copy）
.\scripts\sync-and-build.ps1 -Deploy -DryRun
```

或双击 / 运行：

```text
scripts\sync-and-build.cmd -Deploy
```

## 脚本会做什么

1. `git fetch upstream`  
2. 比较当前分支与 `upstream/main`：  
   - **0 个新提交** → 跳过 merge，直接进入打包（若未 `-SkipBuild`）  
   - **有新提交** → `merge upstream/main` → `main`，再 merge 进当前功能分支，并尝试 `push origin`  
3. `tauri build`，并尽量 **关闭 updater 签名产物**（个人用无需 `TAURI_SIGNING_PRIVATE_KEY`）  
4. `-Deploy` 时：结束运行中的 `skills-manager` → 备份旧 exe → 拷贝新 `skills-manager.exe`（及 cli 若有）

构建产物默认：

```text
src-tauri\target\release\skills-manager.exe
```

## 关于「应用内自动更新」

配置里 updater 仍指向官方：

`https://github.com/xingkongliang/skills-manager/releases/...`

个人使用时若点了自动更新，**可能被官方包覆盖回原版**。建议：

- 忽略更新提示，或在设置里关闭自动更新（若有）；  
- 日常用本脚本重新部署 fork 构建。

## 回滚

每次 `-Deploy` 会在安装目录生成：

```text
skills-manager.exe.bak-yyyyMMdd-HHmmss
```

把备份改回 `skills-manager.exe` 即可恢复该次覆盖前的文件。

## 常见问题

| 问题 | 处理 |
|------|------|
| `cargo` not found | 安装 rustup，新开终端 |
| Access denied 拷贝到 Program Files | 管理员运行 PowerShell |
| 脏工作区拒绝运行 | `git status` → commit 或 stash |
| merge 冲突 | 手动解决 → commit → 再跑脚本 |
| 构建要签名密钥 | 脚本已尝试 `createUpdaterArtifacts: false`；仍失败把报错贴出 |

## 与「整包 NSIS 安装」的区别

| 方式 | 场景 |
|------|------|
| **本脚本 + 覆盖 exe** | 已装官方、自己用、保留快捷方式与数据 |
| `npm run tauri:build` 后跑 NSIS 安装包 | 新机器 / 想完整安装器 |

#Requires -Version 5.1
<#
.SYNOPSIS
  Sync upstream (if changed) and build a personal Windows skills-manager.exe.

.DESCRIPTION
  Solo-use helper for the winlend fork:
    1) git fetch upstream
    2) if upstream/main has new commits → merge into main, then into your branch
       On CONFLICT: script STOPS immediately. Official skills-manager.exe is never
       touched. You resolve git conflicts manually, then re-run.
    3) tauri build (without updater signature artifacts)
    4) copy as a NEW filename beside the official install (default ON;
       skills-manager-winlend.exe — does NOT overwrite skills-manager.exe;
       pass -NoDeploy to skip copy)

  Official install (this machine):
    D:\Program Files\skills-manager\skills-manager.exe

  App data: %LOCALAPPDATA%\com.agentskills.desktop (shared with official)

.PARAMETER NoDeploy
  Skip copying the built exe (deploy is ON by default).

.PARAMETER DeployName
  Filename for your fork build. Default: skills-manager-winlend.exe
  Official skills-manager.exe is never overwritten by this script.

.PARAMETER InstallDir
  Directory for the side-by-side copy. Default: D:\Program Files\skills-manager

.PARAMETER CreateShortcut
  Create a Desktop shortcut to the deployed fork exe.

.PARAMETER Branch
  Working branch to merge upstream into (default: current branch).

.PARAMETER SkipSync / SkipBuild / DryRun
  See examples.

.EXAMPLE
  .\scripts\sync-and-build.ps1 -CreateShortcut

.EXAMPLE
  .\scripts\sync-and-build.ps1 -DeployName "skills-manager-fork.exe"

.EXAMPLE
  .\scripts\sync-and-build.ps1 -NoDeploy
#>

[CmdletBinding()]
param(
  # Deploy is default ON; pass -NoDeploy to only build/sync without copy.
  [switch]$NoDeploy,
  [string]$DeployName = "skills-manager-winlend.exe",
  [string]$InstallDir = "D:\Program Files\skills-manager",
  [switch]$CreateShortcut,
  [string]$Branch = "",
  [switch]$SkipSync,
  [switch]$SkipBuild,
  [switch]$DryRun
)

# Keep $Deploy for logs / summary (true unless -NoDeploy).
$Deploy = -not $NoDeploy

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}
function Write-Ok([string]$msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Write-Info([string]$msg) { Write-Host "    $msg" -ForegroundColor Gray }

function Assert-Cmd([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name. Install it and re-open the terminal."
  }
}

function Show-ConflictHelp {
  param(
    [string]$Where,
    [string]$AbortBranch
  )
  Write-Host ""
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host " MERGE CONFLICT on: $Where" -ForegroundColor Red
  Write-Host " Script STOPPED. Nothing was built. Official .exe NOT modified." -ForegroundColor Red
  Write-Host "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" -ForegroundColor Red
  Write-Host ""
  Write-Host "What happened" -ForegroundColor Yellow
  Write-Host "  Git could not auto-merge your fork changes with upstream."
  Write-Host "  Conflicted files are left in the working tree with markers:"
  Write-Host "    <<<<<<< HEAD"
  Write-Host "    ======="
  Write-Host "    >>>>>>> ..."
  Write-Host ""
  Write-Host "See conflicts" -ForegroundColor Yellow
  Write-Host "  git status"
  Write-Host "  git diff --name-only --diff-filter=U"
  Write-Host ""
  Write-Host "Option A — fix and continue" -ForegroundColor Yellow
  Write-Host "  1) Edit each conflicted file; remove markers; keep the right code"
  Write-Host "  2) git add <files>"
  Write-Host "  3) git commit   # finishes the merge (no -m required if editor opens;"
  Write-Host "                  # or: git commit -m `"chore: resolve merge with upstream`")"
  Write-Host "  4) Re-run:  .\scripts\sync-and-build.ps1"
  Write-Host ""
  Write-Host "Option B — abort merge (back to pre-merge state)" -ForegroundColor Yellow
  Write-Host "  git merge --abort"
  if ($AbortBranch) {
    Write-Host "  git checkout $AbortBranch   # if you were moved to another branch"
  }
  Write-Host ""
  Write-Host "Tips" -ForegroundColor Yellow
  Write-Host "  - Prefer keeping YOUR Library source_key UI in MySkills.tsx when"
  Write-Host "    upstream only touched nearby lines; re-apply fork patches if needed."
  Write-Host "  - docs/FORK.md and docs/plans/* are fork-only — usually keep ours."
  Write-Host ""
}

function Invoke-GitMerge {
  param(
    [string]$IntoBranch,
    [string]$FromRef,
    [string]$Message,
    [string]$ReturnBranch
  )
  git checkout $IntoBranch
  if ($LASTEXITCODE -ne 0) { throw "git checkout $IntoBranch failed" }

  git merge $FromRef -m $Message
  if ($LASTEXITCODE -ne 0) {
    Show-ConflictHelp -Where $IntoBranch -AbortBranch $ReturnBranch
    # Leave repo mid-merge so user can resolve; do not auto-abort
    throw "Merge conflict on '$IntoBranch'. Resolve or: git merge --abort"
  }
  Write-Ok "merged $FromRef → $IntoBranch"
}

# Run a native exe without turning stderr progress into terminating errors.
# PowerShell 5.1 + $ErrorActionPreference=Stop treats git/npm stderr as errors
# when you pipe 2>&1 — even on exit code 0 ("To https://github.com/...").
function Invoke-NativeBestEffort {
  param(
    [string]$Label,
    [scriptblock]$Command
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $Command
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($code -ne 0) {
    Write-Warn "$Label failed (exit $code) — continuing"
    return $false
  }
  Write-Ok $Label
  return $true
}

# --- start ---
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot
Write-Host "Repo: $RepoRoot" -ForegroundColor White

# Safety: never allow DeployName to clobber official binary name accidentally
if ($DeployName -ieq "skills-manager.exe") {
  throw @"
Refusing DeployName=skills-manager.exe (would overwrite official binary).
Use the default skills-manager-winlend.exe or another custom name, e.g.:
  -DeployName skills-manager-fork.exe
"@
}
if ($DeployName -notmatch '\.exe$') {
  $DeployName = "$DeployName.exe"
}

Write-Step "Check toolchain"
Assert-Cmd git
Assert-Cmd npm
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  throw @"
Rust/cargo not found in PATH.
Install from https://rustup.rs/ then open a NEW terminal.
Also install VS Build Tools with 'Desktop development with C++'.
"@
}
Write-Ok "git $(git --version)"
Write-Ok "node $(node --version)"
Write-Ok "cargo $(cargo --version)"

Write-Step "Check remotes"
$remotes = @(git remote)
if ($remotes -notcontains "upstream") {
  git remote add upstream "https://github.com/xingkongliang/skills-manager.git"
  Write-Ok "added upstream → xingkongliang/skills-manager"
} else {
  Write-Ok "upstream present"
}
if ($remotes -notcontains "origin") {
  Write-Warn "origin missing (optional for local-only builds)"
} else {
  Write-Ok "origin present"
}

# Refuse if already in the middle of a merge/rebase
if (Test-Path (Join-Path $RepoRoot ".git\MERGE_HEAD")) {
  Show-ConflictHelp -Where "(existing unfinished merge)" -AbortBranch ""
  throw "Unfinished merge detected. Finish (git commit) or abort (git merge --abort) first."
}
if (Test-Path (Join-Path $RepoRoot ".git\rebase-merge")) {
  throw "Unfinished rebase detected. Finish or: git rebase --abort"
}

# Dirty check: only block modifications to files that also exist on
# upstream/main (shared with official). Untracked / fork-only files are ignored
# so local caches (e.g. .playwright-mcp) and fork-only edits don't stop builds.
# Also ignore "phantom dirty" (git status says modified, but git diff is empty) —
# common on Windows with core.autocrlf=true (e.g. Cargo.toml).
function Get-DirtyPathsBlockingSync {
  # porcelain: "XY path" or "XY orig -> path" for renames
  $lines = @(git status --porcelain --untracked-files=no 2>$null)
  if (-not $lines) { return @() }

  $paths = New-Object System.Collections.Generic.List[string]
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    # Skip untracked/ignored (shouldn't appear with -uno, but be safe)
    $xy = $line.Substring(0, [Math]::Min(2, $line.Length))
    if ($xy -match '^\?\?' -or $xy -match '^!!') { continue }

    $rest = $line.Substring(3).Trim()
    if ($rest -match ' -> ') {
      $rest = ($rest -split ' -> ', 2)[1]
    }
    # Strip optional quotes
    $rest = $rest.Trim('"')
    if ($rest) { [void]$paths.Add($rest) }
  }
  $paths = @($paths | Select-Object -Unique)
  if ($paths.Count -eq 0) { return @() }

  # Prefer filtering to files present on upstream/main (shared surface).
  $upstreamRef = $null
  git show-ref --verify --quiet refs/remotes/upstream/main 2>$null
  if ($LASTEXITCODE -eq 0) {
    $upstreamRef = "upstream/main"
  } else {
    git show-ref --verify --quiet refs/remotes/origin/main 2>$null
    if ($LASTEXITCODE -eq 0) { $upstreamRef = "origin/main" }
  }

  if (-not $upstreamRef) {
    # No remote main to compare: still drop phantom-dirty paths.
    return @(Get-PathsWithRealDiff -Paths $paths)
  }

  $shared = New-Object System.Collections.Generic.List[string]
  foreach ($p in $paths) {
    # path exists as blob/tree entry on upstream/main?
    git cat-file -e "${upstreamRef}:$p" 2>$null
    if ($LASTEXITCODE -eq 0) {
      [void]$shared.Add($p)
    }
  }
  return @(Get-PathsWithRealDiff -Paths @($shared))
}

function Get-PathsWithRealDiff {
  param([string[]]$Paths)
  if (-not $Paths -or $Paths.Count -eq 0) { return @() }

  $real = New-Object System.Collections.Generic.List[string]
  $phantom = New-Object System.Collections.Generic.List[string]
  foreach ($p in $Paths) {
    # Empty output = no content change vs HEAD (or unstaged empty after smudge).
    $diffOut = git diff --unified=0 --ignore-cr-at-eol -- $p 2>$null
    $stagedOut = git diff --cached --unified=0 --ignore-cr-at-eol -- $p 2>$null
    $hasDiff = ($diffOut -and (@($diffOut).Count -gt 0)) -or ($stagedOut -and (@($stagedOut).Count -gt 0))
    if ($hasDiff) {
      [void]$real.Add($p)
    } else {
      [void]$phantom.Add($p)
    }
  }
  if ($phantom.Count -gt 0) {
    Write-Info ("Ignoring {0} phantom-dirty path(s) (status dirty, empty diff; often CRLF):" -f $phantom.Count)
    foreach ($p in $phantom) { Write-Info "  - $p" }
    # Best-effort: refresh index so later git status is cleaner (non-fatal).
    foreach ($p in $phantom) {
      git update-index --refresh -- $p 2>$null | Out-Null
    }
  }
  return @($real)
}

$blockingDirty = @(Get-DirtyPathsBlockingSync)
if ($blockingDirty.Count -gt 0) {
  Write-Warn "Tracked files that also exist on upstream/main are dirty:"
  foreach ($p in $blockingDirty) { Write-Host "    - $p" -ForegroundColor Yellow }
  Write-Info "Untracked / fork-only paths are ignored for this check."
  throw "Commit or stash shared-file changes before sync/build so merges stay safe."
} else {
  $anyTracked = @(git status --porcelain --untracked-files=no 2>$null)
  if ($anyTracked) {
    Write-Info "Local tracked changes are fork-only (not on upstream/main) — OK to continue."
  }
  $untracked = @(git status --porcelain --untracked-files=normal 2>$null | Where-Object { $_ -match '^\?\?' })
  if ($untracked) {
    Write-Info ("Ignoring {0} untracked path(s) (e.g. local caches)." -f $untracked.Count)
  }
}

$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if (-not $Branch) { $Branch = $currentBranch }
Write-Info "Branch: $Branch"
Write-Info "Deploy name (side-by-side): $DeployName"
Write-Info "Will NOT touch: skills-manager.exe (official)"

# --- sync ---
$upstreamAhead = 0
if (-not $SkipSync) {
  Write-Step "Fetch upstream"
  if ($DryRun) {
    Write-Info "[dry-run] git fetch upstream"
  } else {
    git fetch upstream --tags
  }

  git show-ref --verify --quiet refs/heads/main 2>$null
  if ($LASTEXITCODE -ne 0) {
    if (-not $DryRun) {
      git branch main upstream/main 2>$null
      if ($LASTEXITCODE -ne 0) {
        git checkout -B main upstream/main
        git checkout $Branch
      }
    } else {
      Write-Info "[dry-run] create local main from upstream/main"
    }
  }

  Write-Step "Compare $Branch with upstream/main"
  $aheadList = git rev-list --count "${Branch}..upstream/main" 2>$null
  if ($LASTEXITCODE -ne 0) {
    $aheadList = git rev-list --count "HEAD..upstream/main"
  }
  $upstreamAhead = [int]$aheadList
  $behindUs = 0
  $behindRaw = git rev-list --count "upstream/main..${Branch}" 2>$null
  if ($LASTEXITCODE -eq 0) { $behindUs = [int]$behindRaw }

  if ($upstreamAhead -eq 0) {
    Write-Ok "upstream/main has no new commits for this branch (already up to date)."
  } else {
    Write-Warn "upstream/main is ahead by $upstreamAhead commit(s). Your branch is ahead of upstream by $behindUs commit(s)."
    git log --oneline "${Branch}..upstream/main" 2>$null | Select-Object -First 15 | ForEach-Object { Write-Info $_ }

    if ($DryRun) {
      Write-Info "[dry-run] would merge upstream/main → main → $Branch"
      Write-Info "[dry-run] on conflict: STOP + print resolve/abort help (no auto-resolve)"
    } else {
      Write-Step "Merge upstream/main → main"
      try {
        Invoke-GitMerge -IntoBranch "main" -FromRef "upstream/main" `
          -Message "chore: merge upstream/main into main" -ReturnBranch $Branch
      } catch {
        # try return to original branch if possible
        git checkout $Branch 2>$null
        throw
      }

      if ($Branch -ne "main") {
        Write-Step "Merge main → $Branch"
        Invoke-GitMerge -IntoBranch $Branch -FromRef "main" `
          -Message "chore: merge main (upstream sync) into $Branch" -ReturnBranch $Branch
      }

      if ($remotes -contains "origin") {
        Write-Step "Push to origin (best-effort)"
        [void](Invoke-NativeBestEffort "git push origin main" {
          git push origin main
        })
        if ($Branch -ne "main") {
          [void](Invoke-NativeBestEffort "git push origin $Branch" {
            git push origin $Branch
          })
        }
      }
    }
  }
} else {
  Write-Warn "SkipSync: not fetching upstream"
}

# --- build ---
$builtExe = Join-Path $RepoRoot "src-tauri\target\release\skills-manager.exe"
if (-not $SkipBuild) {
  Write-Step "Install npm deps (if needed)"
  if ($DryRun) {
    Write-Info "[dry-run] npm ci / tauri build"
  } else {
    if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
      npm ci
    } else {
      Write-Info "node_modules exists (skip npm ci)."
    }

    Write-Step "Tauri build (no updater signature artifacts)"
    Write-Info "This can take several minutes on first run..."
    $mergeConf = Join-Path $RepoRoot "src-tauri\tauri.personal-build.conf.json"
    @'
{
  "bundle": {
    "createUpdaterArtifacts": false
  }
}
'@ | Set-Content -Path $mergeConf -Encoding utf8

    npm run tauri -- build --config "src-tauri/tauri.personal-build.conf.json"
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "Build with personal config failed; retry plain tauri:build"
      npm run tauri:build
      if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
    }

    if (-not (Test-Path $builtExe)) {
      throw "Build finished but exe not found: $builtExe"
    }
    $item = Get-Item $builtExe
    Write-Ok "Built: $($item.FullName) ($([math]::Round($item.Length/1MB,1)) MB)"
  }
} else {
  Write-Warn "SkipBuild: not compiling"
}

# --- deploy side-by-side ---
$targetExe = Join-Path $InstallDir $DeployName
$cliSrc = Join-Path $RepoRoot "src-tauri\target\release\skills-manager-cli.exe"
$cliDst = Join-Path $InstallDir "skills-manager-cli-winlend.exe"

if ($Deploy) {
  Write-Step "Deploy side-by-side (official exe untouched)"
  Write-Info "Official stays: $(Join-Path $InstallDir 'skills-manager.exe')"
  Write-Info "Fork copy to:  $targetExe"

  if ($DryRun) {
    Write-Info "[dry-run] Copy-Item built → $targetExe"
    if ($CreateShortcut) { Write-Info "[dry-run] create Desktop shortcut" }
  } else {
    if (-not (Test-Path $InstallDir)) {
      throw "InstallDir not found: $InstallDir"
    }
    if (-not (Test-Path $builtExe)) {
      throw "Built exe missing: $builtExe"
    }

    # Do not kill official process unless our fork name is running
    $forkBase = [System.IO.Path]::GetFileNameWithoutExtension($DeployName)
    $procs = Get-Process -Name $forkBase -ErrorAction SilentlyContinue
    if ($procs) {
      Write-Warn "Stopping running $forkBase process(es)..."
      $procs | Stop-Process -Force
      Start-Sleep -Seconds 1
    }

    # Optional backup of previous *fork* build only
    if (Test-Path $targetExe) {
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $bak = "$targetExe.bak-$stamp"
      try {
        Copy-Item -LiteralPath $targetExe -Destination $bak -Force
        Write-Ok "Previous fork backup: $bak"
      } catch {
        throw "Cannot write to $InstallDir (need Administrator?). $_"
      }
    }

    try {
      Copy-Item -LiteralPath $builtExe -Destination $targetExe -Force
      Write-Ok "Deployed fork: $targetExe"
      if (Test-Path $cliSrc) {
        Copy-Item -LiteralPath $cliSrc -Destination $cliDst -Force
        Write-Ok "Deployed fork CLI: $cliDst"
      }
    } catch {
      throw "Deploy failed (permission?). Run PowerShell as Administrator. $_"
    }

    if ($CreateShortcut) {
      $desk = [Environment]::GetFolderPath("Desktop")
      $lnkPath = Join-Path $desk "Skills Manager (winlend).lnk"
      $w = New-Object -ComObject WScript.Shell
      $sc = $w.CreateShortcut($lnkPath)
      $sc.TargetPath = $targetExe
      $sc.WorkingDirectory = $InstallDir
      $sc.Description = "Skills Manager — winlend fork (side-by-side)"
      $sc.Save()
      Write-Ok "Desktop shortcut: $lnkPath"
    }
  }
}

Write-Step "Done"
Write-Host @"

Summary
  Upstream new commits this run: $upstreamAhead (0 = none / already synced)
  Built:       $builtExe
  Install dir: $InstallDir
  Fork exe:    $targetExe
  Official:    $(Join-Path $InstallDir 'skills-manager.exe')  (never overwritten)
  Deployed:    $Deploy

Conflict policy
  On merge conflict the script STOPS. No auto-resolve. No deploy.
  Resolve: edit files → git add → git commit → re-run script
  Abort:   git merge --abort

Typical commands
  .\scripts\sync-and-build.ps1 -CreateShortcut
  .\scripts\sync-and-build.ps1 -SkipBuild
  .\scripts\sync-and-build.ps1 -SkipSync
  .\scripts\sync-and-build.ps1 -NoDeploy

Start your fork
  & "$targetExe"
  or double-click Desktop shortcut if -CreateShortcut was used

Data dir (shared with official)
  %LOCALAPPDATA%\com.agentskills.desktop

"@ -ForegroundColor White

#Requires -Version 5.1
<#
.SYNOPSIS
  Sync upstream (if changed) and build a personal Windows skills-manager.exe.

.DESCRIPTION
  For solo use of the winlend fork:
    1) git fetch upstream
    2) if upstream/main has new commits → merge into main and current feature branch
    3) tauri build (without updater signature artifacts)
    4) optional: backup + copy exe into the official install dir

  Official install on this machine (from Start Menu shortcut):
    D:\Program Files\skills-manager\skills-manager.exe

  App data stays under %LOCALAPPDATA%\com.agentskills.desktop (same identifier),
  so replacing the exe keeps your library/presets.

.PARAMETER Deploy
  After a successful build, overwrite the install-dir exe (requires write access;
  usually "Run as Administrator" if install is under Program Files).

.PARAMETER InstallDir
  Target install directory. Default: D:\Program Files\skills-manager

.PARAMETER Branch
  Working branch to merge upstream into (default: current branch).

.PARAMETER SkipSync
  Only build; do not fetch/merge upstream.

.PARAMETER SkipBuild
  Only sync; do not build.

.PARAMETER DryRun
  Print what would happen; no merge/build/deploy.

.EXAMPLE
  .\scripts\sync-and-build.ps1

.EXAMPLE
  .\scripts\sync-and-build.ps1 -Deploy

.EXAMPLE
  .\scripts\sync-and-build.ps1 -Deploy -InstallDir "D:\Program Files\skills-manager"
#>

[CmdletBinding()]
param(
  [switch]$Deploy,
  [string]$InstallDir = "D:\Program Files\skills-manager",
  [string]$Branch = "",
  [switch]$SkipSync,
  [switch]$SkipBuild,
  [switch]$DryRun
)

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

# Resolve repo root (script lives in scripts/)
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot
Write-Host "Repo: $RepoRoot" -ForegroundColor White

# --- toolchain ---
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

# --- git remotes ---
Write-Step "Check remotes"
$remotes = git remote 2>&1
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

$status = git status --porcelain
if ($status) {
  Write-Warn "Working tree is dirty:"
  git status -sb
  throw "Commit or stash local changes before sync/build so merges stay safe."
}

$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
if (-not $Branch) { $Branch = $currentBranch }
Write-Info "Branch: $Branch"

# --- sync upstream ---
$upstreamAhead = 0
if (-not $SkipSync) {
  Write-Step "Fetch upstream"
  if ($DryRun) {
    Write-Info "[dry-run] git fetch upstream"
  } else {
    git fetch upstream --tags
  }

  # Ensure local main exists
  git show-ref --verify --quiet refs/heads/main 2>$null
  if ($LASTEXITCODE -ne 0) {
    if ($DryRun) {
      Write-Info "[dry-run] create local main from upstream/main"
    } else {
      git branch main upstream/main 2>$null
      if ($LASTEXITCODE -ne 0) {
        git checkout -B main upstream/main
        git checkout $Branch
      }
    }
  }

  Write-Step "Compare $Branch with upstream/main"
  # commits on upstream/main not in current branch
  $aheadList = git rev-list --count "${Branch}..upstream/main" 2>$null
  if ($LASTEXITCODE -ne 0) {
    $aheadList = git rev-list --count "HEAD..upstream/main"
  }
  $upstreamAhead = [int]$aheadList
  $behindUs = [int](git rev-list --count "upstream/main..${Branch}" 2>$null)

  if ($upstreamAhead -eq 0) {
    Write-Ok "upstream/main has no new commits for this branch (already up to date)."
  } else {
    Write-Warn "upstream/main is ahead by $upstreamAhead commit(s). Local branch is ahead of upstream by $behindUs commit(s)."
    git log --oneline "${Branch}..upstream/main" | Select-Object -First 15 | ForEach-Object { Write-Info $_ }

    if ($DryRun) {
      Write-Info "[dry-run] would merge upstream/main into main, then into $Branch"
    } else {
      Write-Step "Merge upstream/main → main"
      git checkout main
      git merge upstream/main -m "chore: merge upstream/main into main"
      if ($LASTEXITCODE -ne 0) {
        throw "Merge conflict on main. Resolve, commit, then re-run this script."
      }
      Write-Ok "main updated"

      if ($Branch -ne "main") {
        Write-Step "Merge main → $Branch"
        git checkout $Branch
        git merge main -m "chore: merge main (upstream sync) into $Branch"
        if ($LASTEXITCODE -ne 0) {
          throw "Merge conflict on $Branch. Resolve, commit, then re-run."
        }
        Write-Ok "$Branch updated with upstream"
      }

      # Optional push if origin exists
      if ((git remote) -contains "origin") {
        Write-Step "Push to origin (best-effort)"
        git push origin main 2>&1 | Out-Host
        if ($Branch -ne "main") {
          git push origin $Branch 2>&1 | Out-Host
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
    Write-Info "[dry-run] npm ci / npm run tauri build"
  } else {
    if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
      npm ci
    } else {
      Write-Info "node_modules exists (skip npm ci). Use 'npm ci' manually if deps look stale."
    }

    Write-Step "Tauri build (no updater signature artifacts)"
    Write-Info "This can take several minutes on first run..."
    # Write a tiny merge config so personal builds don't need TAURI_SIGNING_PRIVATE_KEY
    $mergeConf = Join-Path $RepoRoot "src-tauri\tauri.personal-build.conf.json"
    @'
{
  "bundle": {
    "createUpdaterArtifacts": false
  }
}
'@ | Set-Content -Path $mergeConf -Encoding utf8

    # tauri CLI merges extra --config JSON files
    npm run tauri -- build --config "src-tauri/tauri.personal-build.conf.json"
    $buildOk = ($LASTEXITCODE -eq 0)
    if (-not $buildOk) {
      Write-Warn "Build with personal config failed; retry plain tauri:build (may require signing key)"
      npm run tauri:build
      if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
    }
    # keep merge conf for next runs; it only disables updater artifacts

    if (-not (Test-Path $builtExe)) {
      throw "Build finished but exe not found: $builtExe"
    }
    $item = Get-Item $builtExe
    Write-Ok "Built: $($item.FullName) ($([math]::Round($item.Length/1MB,1)) MB, $($item.LastWriteTime))"
  }
} else {
  Write-Warn "SkipBuild: not compiling"
}

# --- deploy ---
if ($Deploy) {
  Write-Step "Deploy to install directory"
  $targetExe = Join-Path $InstallDir "skills-manager.exe"
  $cliSrc = Join-Path $RepoRoot "src-tauri\target\release\skills-manager-cli.exe"
  $cliDst = Join-Path $InstallDir "skills-manager-cli.exe"

  if ($DryRun) {
    Write-Info "[dry-run] would copy $builtExe → $targetExe"
    if (Test-Path $cliSrc) { Write-Info "[dry-run] would copy CLI → $cliDst" }
  } else {
    if (-not (Test-Path $InstallDir)) {
      throw "InstallDir not found: $InstallDir. Adjust -InstallDir."
    }
    if (-not (Test-Path $builtExe)) {
      throw "Built exe missing: $builtExe (run without -SkipBuild first)"
    }

    # Stop running app if possible
    $procs = Get-Process -Name "skills-manager" -ErrorAction SilentlyContinue
    if ($procs) {
      Write-Warn "Stopping running skills-manager process(es)..."
      $procs | Stop-Process -Force
      Start-Sleep -Seconds 1
    }

    # Backup existing exe
    if (Test-Path $targetExe) {
      $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $bak = Join-Path $InstallDir "skills-manager.exe.bak-$stamp"
      try {
        Copy-Item -LiteralPath $targetExe -Destination $bak -Force
        Write-Ok "Backup: $bak"
      } catch {
        throw "Cannot write to $InstallDir. Re-run PowerShell as Administrator. $_"
      }
    }

    try {
      Copy-Item -LiteralPath $builtExe -Destination $targetExe -Force
      Write-Ok "Deployed: $targetExe"
      if (Test-Path $cliSrc) {
        Copy-Item -LiteralPath $cliSrc -Destination $cliDst -Force
        Write-Ok "Deployed CLI: $cliDst"
      }
    } catch {
      throw "Deploy failed (permission?). Run as Administrator. $_"
    }
  }
}

# --- summary ---
Write-Step "Done"
Write-Host @"

Summary
  Upstream new commits merged this run: $upstreamAhead (0 = none / already synced)
  Built exe:  $builtExe
  Install dir: $InstallDir
  Deployed:    $Deploy

Personal-use notes
  1) Close Skills Manager before -Deploy (script also tries to kill it).
  2) Overwriting Program Files usually needs Administrator.
  3) App data is NOT in the install dir — it stays in:
       %LOCALAPPDATA%\com.agentskills.desktop
     Same app id → your library/presets keep working.
  4) In-app auto-update still points at upstream GitHub releases.
     Prefer: Settings → disable auto-update (if available), or ignore update prompts,
     otherwise an official update may replace your fork build.
  5) To only check upstream without building:
       .\scripts\sync-and-build.ps1 -SkipBuild
  6) To rebuild without syncing:
       .\scripts\sync-and-build.ps1 -SkipSync -Deploy

"@ -ForegroundColor White

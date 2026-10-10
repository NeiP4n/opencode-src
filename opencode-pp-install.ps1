# Installs Opencode++ for Windows with one command. In PowerShell:
#
#   irm https://raw.githubusercontent.com/NeiP4n/opencode-src/lan-rooms/opencode-pp-install.ps1 | iex
#
# Missing Git comes from winget, Bun from bun.sh. The newest release is checked
# out into %LOCALAPPDATA%\opencode-pp and the `opencode-pp` command is added to your
# user PATH, so it works in this window right away. A regular opencode keeps the
# `opencode` command. Running this again updates.
$ErrorActionPreference = "Stop"

$Repo = if ($env:OPENCODE_PP_REPO) { $env:OPENCODE_PP_REPO } else { "https://github.com/NeiP4n/opencode-src.git" }
$Dir = if ($env:OPENCODE_PP_DIR) { $env:OPENCODE_PP_DIR } else { Join-Path $env:LOCALAPPDATA "opencode-pp" }
$Bin = Join-Path $Dir "bin"
$Branch = if ($env:OPENCODE_PP_BRANCH) { $env:OPENCODE_PP_BRANCH } else { "lan-rooms" }

# Programs installed below land in the machine or user PATH; this window only sees them after a refresh.
function Update-SessionPath {
  $env:Path = @(
    [Environment]::GetEnvironmentVariable("Path", "Machine"),
    [Environment]::GetEnvironmentVariable("Path", "User"),
    "$env:USERPROFILE\.bun\bin"
  ) -join ";"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Git is required and winget is not available. Install Git from https://git-scm.com/download/win, then run this again."
  }
  Write-Host "Installing Git..."
  winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
  Update-SessionPath
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git was installed but is not on PATH yet. Open a new PowerShell and run this again."
  }
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Bun..."
  powershell -NoProfile -ExecutionPolicy Bypass -c "irm bun.sh/install.ps1 | iex"
  Update-SessionPath
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw "Bun did not install. See https://bun.sh for a manual install." }
}

$Source = Join-Path $Dir "src"
if (Test-Path (Join-Path $Source ".git")) {
  Write-Host "Updating $Source..."
  git -C $Source fetch --tags --force origin
} else {
  Write-Host "Downloading Opencode++ into $Source..."
  git clone --filter=blob:none $Repo $Source
}
if ($LASTEXITCODE -ne 0) { throw "git failed." }

# A release tag is the normal path. Before the first release exists there is nothing to check
# out, and an installer that only knows tags leaves a newcomer with no way in, so the branch
# with the patches is the fallback.
$Tag = git -C $Source tag -l "release/*" --sort=-v:refname | Select-Object -First 1
if ($Tag) {
  git -C $Source checkout --quiet --detach $Tag
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed." }
  $Version = $Tag -replace "^release/", ""
} else {
  Write-Host "No release is published yet; installing branch $Branch."
  git -C $Source fetch --force origin $Branch
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }
  git -C $Source checkout --quiet --detach "origin/$Branch"
  if ($LASTEXITCODE -ne 0) { throw "git checkout failed." }
  $Version = "$Branch (no release yet)"
}

Write-Host "Installing dependencies..."
Push-Location $Source
# Only what the terminal app needs; the web and desktop apps pull far more.
bun install --frozen-lockfile --filter ./packages/cli
$Installed = $LASTEXITCODE
Pop-Location
if ($Installed -ne 0) { throw "bun install failed." }

New-Item -ItemType Directory -Force -Path $Bin | Out-Null
$Bun = (Get-Command bun).Source
$Cli = Join-Path $Source "packages\cli"
# The command is `opencode-pp`, so a regular opencode on the same machine keeps `opencode`.
# The preload goes by absolute path: bunfig.toml names it by package, which Bun resolves from
# the directory the command is started in.
# A console left on its OEM code page (866, 437 and so on) turns the interface's symbols into `?`, so the
# command switches it to UTF-8 while it runs and puts the old code page back on exit.
Set-Content -Path (Join-Path $Bin "opencode-pp.cmd") -Encoding ASCII -Value @"
@echo off
setlocal
for /f "tokens=2 delims=:" %%c in ('chcp') do set /a OPENCODE_PP_CP=%%c
chcp 65001 >nul
"$Bun" --preload="$Cli\node_modules\@opentui\solid\scripts\preload.js" "$Cli\src\index.ts" %*
set OPENCODE_PP_EXIT=%ERRORLEVEL%
if defined OPENCODE_PP_CP chcp %OPENCODE_PP_CP% >nul
exit /b %OPENCODE_PP_EXIT%
"@
# Earlier versions of this installer took the name `opencode` in this folder; give it back.
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Bin "opencode.cmd")

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($UserPath -split ";" | Where-Object { $_ -eq $Bin })) {
  [Environment]::SetEnvironmentVariable("Path", (@($UserPath, $Bin) | Where-Object { $_ }) -join ";", "User")
  Write-Host "Added $Bin to your PATH."
}
# `irm | iex` runs in this window, so the command works here without reopening it.
if (-not ($env:Path -split ";" | Where-Object { $_ -eq $Bin })) { $env:Path = "$env:Path;$Bin" }

Write-Host ""
Write-Host "Opencode++ $Version is installed. Run: opencode-pp"

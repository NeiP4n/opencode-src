# Installs Opencode++ for Windows. In PowerShell:
#
#   irm https://raw.githubusercontent.com/NeiP4n/opencode-src/v2/opencode-pp-install.ps1 | iex
#
# The newest release is checked out into %LOCALAPPDATA%\opencode-pp and the
# `opencode` command is added to your user PATH. Updates come later from the
# update prompt inside Opencode++; running this script again also updates.
$ErrorActionPreference = "Stop"

$Repo = if ($env:OPENCODE_PP_REPO) { $env:OPENCODE_PP_REPO } else { "https://github.com/NeiP4n/opencode-src.git" }
$Dir = if ($env:OPENCODE_PP_DIR) { $env:OPENCODE_PP_DIR } else { Join-Path $env:LOCALAPPDATA "opencode-pp" }
$Bin = Join-Path $Dir "bin"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required. Install it with: winget install --id Git.Git -e, then open a new PowerShell and run this again."
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Bun..."
  powershell -c "irm bun.sh/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
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

$Tag = git -C $Source tag -l "release/*" --sort=-v:refname | Select-Object -First 1
if (-not $Tag) { throw "No release is published yet." }
git -C $Source checkout --quiet --detach $Tag
if ($LASTEXITCODE -ne 0) { throw "git checkout failed." }

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
Set-Content -Path (Join-Path $Bin "opencode.cmd") -Encoding ASCII -Value @"
@echo off
"$Bun" --config="$Cli\bunfig.toml" "$Cli\src\index.ts" %*
"@

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($UserPath -split ";" | Where-Object { $_ -eq $Bin })) {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$Bin", "User")
  Write-Host "Added $Bin to your PATH. Open a new terminal to use it."
}

$Version = $Tag -replace "^release/", ""
Write-Host ""
Write-Host "Opencode++ $Version is installed. Run: opencode"

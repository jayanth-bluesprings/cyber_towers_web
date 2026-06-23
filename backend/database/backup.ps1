<#
.SYNOPSIS
  Backup (and optionally restore) the CyberTowers PostgreSQL database.

.DESCRIPTION
  Reads connection settings from backend/.env, runs pg_dump to a compressed
  custom-format archive, and prunes backups older than -RetentionDays.
  Designed to be run from Windows Task Scheduler nightly.

.EXAMPLE
  # Nightly backup to the default .\backups folder, keep 14 days
  powershell -ExecutionPolicy Bypass -File database\backup.ps1

.EXAMPLE
  # Restore a specific archive into the configured database
  powershell -File database\backup.ps1 -Restore -File backups\cybertowers_20260618.dump
#>

param(
  [string]$OutDir = (Join-Path $PSScriptRoot 'backups'),
  [int]$RetentionDays = 14,
  [switch]$Restore,
  [string]$File
)

$ErrorActionPreference = 'Stop'

# ── Load .env ────────────────────────────────────────────────────────────────
$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envPath)) { throw "Cannot find backend\.env at $envPath" }

$envVars = @{}
Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
    $envVars[$matches[1]] = $matches[2].Trim()
  }
}

$pgHost = if ($envVars['PG_HOST']) { $envVars['PG_HOST'] } else { 'localhost' }
$pgPort = if ($envVars['PG_PORT']) { $envVars['PG_PORT'] } else { '5432' }
$pgDb   = if ($envVars['PG_DATABASE']) { $envVars['PG_DATABASE'] } else { 'cybertowers_access' }
$pgUser = $envVars['PG_USER']
$env:PGPASSWORD = $envVars['PG_PASSWORD']

if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "pg_dump not found on PATH. Add PostgreSQL's bin folder to PATH (e.g. C:\Program Files\PostgreSQL\16\bin)."
}

# ── Restore mode ─────────────────────────────────────────────────────────────
if ($Restore) {
  if (-not $File -or -not (Test-Path $File)) { throw "Provide a valid -File path to restore." }
  Write-Host "Restoring $File into $pgDb …" -ForegroundColor Yellow
  & pg_restore --host=$pgHost --port=$pgPort --username=$pgUser --dbname=$pgDb --clean --if-exists --no-owner $File
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed (exit $LASTEXITCODE)." }
  Write-Host "Restore complete." -ForegroundColor Green
  return
}

# ── Backup mode ──────────────────────────────────────────────────────────────
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$stamp  = Get-Date -Format 'yyyyMMdd_HHmmss'
$target = Join-Path $OutDir "$($pgDb)_$stamp.dump"

Write-Host "Backing up $pgDb -> $target" -ForegroundColor Cyan
& pg_dump --host=$pgHost --port=$pgPort --username=$pgUser --dbname=$pgDb --format=custom --compress=9 --file=$target
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed (exit $LASTEXITCODE)." }

$sizeMB = [math]::Round((Get-Item $target).Length / 1MB, 2)
Write-Host "Backup complete: $target ($sizeMB MB)" -ForegroundColor Green

# ── Prune old backups ────────────────────────────────────────────────────────
$cutoff = (Get-Date).AddDays(-$RetentionDays)
$pruned = Get-ChildItem $OutDir -Filter "$($pgDb)_*.dump" |
  Where-Object { $_.LastWriteTime -lt $cutoff }
foreach ($old in $pruned) {
  Remove-Item $old.FullName -Force
  Write-Host "Pruned old backup: $($old.Name)" -ForegroundColor DarkGray
}

$env:PGPASSWORD = $null

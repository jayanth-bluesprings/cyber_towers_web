#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Install, uninstall, start, or stop the CyberTowers Bridge Windows Service.

.DESCRIPTION
    Builds the .NET 8 x86 Bridge application and registers it as a Windows Service
    that auto-starts with the OS. Must be run as Administrator.

.PARAMETER Action
    install   — build and register the service (default)
    uninstall — stop and remove the service
    start     — start the already-installed service
    stop      — stop the service

.PARAMETER ExpressUrl
    Base URL of the Express backend (default: http://localhost:5000)

.PARAMETER UseStub
    Pass -UseStub to run in stub mode (no FC8900 DLL required, simulated events).

.EXAMPLE
    # Normal install (production)
    .\install-service.ps1

    # Install with stub SDK for development / testing
    .\install-service.ps1 -UseStub

    # Uninstall
    .\install-service.ps1 -Action uninstall
#>

param(
    [ValidateSet("install","uninstall","start","stop")]
    [string]$Action     = "install",

    [string]$ExpressUrl = "http://localhost:5000",

    [switch]$UseStub
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ServiceName   = "CyberTowersBridge"
$ServiceDisplay= "CyberTowers Bridge Service"
$ServiceDesc   = "Bridges FC8900 RFID controllers to the CyberTowers access dashboard."
$ProjectDir    = Join-Path $PSScriptRoot "CyberTowers.Bridge"
$PublishDir    = Join-Path $ProjectDir   "bin\publish"
$ExePath       = Join-Path $PublishDir   "CyberTowers.Bridge.exe"

function Build-Bridge {
    Write-Host "`n[1/3] Restoring + building (x86 Release)..." -ForegroundColor Cyan
    Push-Location $ProjectDir
    try {
        dotnet publish `
            --configuration Release `
            --runtime win-x86 `
            --self-contained true `
            -p:PublishSingleFile=true `
            --output $PublishDir
        if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }
    } finally { Pop-Location }

    Write-Host "[1/3] Build complete → $PublishDir" -ForegroundColor Green
}

function Install-Service {
    Build-Bridge

    # Patch appsettings in publish dir if needed
    $cfg = Join-Path $PublishDir "appsettings.json"
    if (Test-Path $cfg) {
        $json = Get-Content $cfg -Raw | ConvertFrom-Json
        $json.Bridge.ExpressBaseUrl = $ExpressUrl
        if ($UseStub) { $json.Bridge.UseStubSdk = $true }
        $json | ConvertTo-Json -Depth 10 | Set-Content $cfg -Encoding UTF8
        Write-Host "[2/3] appsettings patched (ExpressUrl=$ExpressUrl, Stub=$UseStub)" -ForegroundColor Cyan
    }

    # Register service
    if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
        Write-Host "[2/3] Service already exists — removing old entry..." -ForegroundColor Yellow
        Stop-Service  -Name $ServiceName -Force -ErrorAction SilentlyContinue
        sc.exe delete $ServiceName | Out-Null
        Start-Sleep -Seconds 2
    }

    Write-Host "[3/3] Registering Windows Service..." -ForegroundColor Cyan
    New-Service `
        -Name        $ServiceName `
        -DisplayName $ServiceDisplay `
        -Description $ServiceDesc `
        -BinaryPathName $ExePath `
        -StartupType Automatic

    Start-Service -Name $ServiceName
    Write-Host "`nService '$ServiceName' installed and started." -ForegroundColor Green
    Get-Service -Name $ServiceName | Format-List Name, Status, StartType
}

function Uninstall-Service {
    Write-Host "Stopping and removing '$ServiceName'..." -ForegroundColor Yellow
    Stop-Service  -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Write-Host "Done." -ForegroundColor Green
}

function Start-Bridge {
    Write-Host "Starting '$ServiceName'..." -ForegroundColor Cyan
    Start-Service -Name $ServiceName
    Get-Service   -Name $ServiceName | Format-List Name, Status
}

function Stop-Bridge {
    Write-Host "Stopping '$ServiceName'..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force
    Get-Service  -Name $ServiceName | Format-List Name, Status
}

switch ($Action) {
    "install"   { Install-Service }
    "uninstall" { Uninstall-Service }
    "start"     { Start-Bridge }
    "stop"      { Stop-Bridge }
}

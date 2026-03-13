$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Join-Path $root 'backend'
$frontendDir = Join-Path $root 'frontend'
$healthUrl = 'http://localhost:5000/health'
$appUrl = 'http://localhost:5000'
$frontendDist = Join-Path $frontendDir 'dist\index.html'
$backendPackageJson = Join-Path $backendDir 'package.json'
$backendPackageLock = Join-Path $backendDir 'package-lock.json'
$frontendPackageJson = Join-Path $frontendDir 'package.json'
$frontendPackageLock = Join-Path $frontendDir 'package-lock.json'

Add-Type -AssemblyName System.Windows.Forms

function Show-Error($message) {
  [System.Windows.Forms.MessageBox]::Show($message, 'Vehicle Access Dashboard') | Out-Null
}

function Invoke-HiddenCommand($workingDirectory, $commandLine) {
  $process = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', $commandLine `
    -WorkingDirectory $workingDirectory `
    -WindowStyle Hidden `
    -PassThru `
    -Wait

  return $process.ExitCode
}

function Test-DashboardRunning {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Stop-DashboardServer {
  try {
    $connections = netstat -ano | Select-String ':5000'
    $pids = @()

    foreach ($line in $connections) {
      $parts = ($line.ToString() -replace '\s+', ' ').Trim().Split(' ')
      if ($parts.Length -ge 5 -and $parts[1] -match ':5000$') {
        $pid = $parts[-1]
        if ($pid -match '^\d+$' -and $pid -ne '0') {
          $pids += [int]$pid
        }
      }
    }

    $pids = $pids | Sort-Object -Unique
    foreach ($pid in $pids) {
      try {
        Stop-Process -Id $pid -Force -ErrorAction Stop
      } catch {
      }
    }
  } catch {
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Show-Error 'Node.js is not installed. Please install Node.js on this computer first.'
  exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Show-Error 'npm is not installed. Please install Node.js with npm on this computer first.'
  exit 1
}

if (
  -not (Test-Path (Join-Path $backendDir 'node_modules')) -or
  -not (Test-Path $backendPackageLock) -or
  (Get-Item $backendPackageJson).LastWriteTime -gt (Get-Item $backendPackageLock).LastWriteTime
) {
  $backendInstallExit = Invoke-HiddenCommand $backendDir 'npm.cmd install'
  if ($backendInstallExit -ne 0) {
    Show-Error 'Backend setup failed. Please check backend dependencies.'
    exit 1
  }
}

if (
  -not (Test-Path (Join-Path $frontendDir 'node_modules')) -or
  -not (Test-Path $frontendPackageLock) -or
  (Get-Item $frontendPackageJson).LastWriteTime -gt (Get-Item $frontendPackageLock).LastWriteTime
) {
  $frontendInstallExit = Invoke-HiddenCommand $frontendDir 'npm.cmd install'
  if ($frontendInstallExit -ne 0) {
    Show-Error 'Frontend setup failed. Please check frontend dependencies.'
    exit 1
  }
}

if (Test-Path (Join-Path $frontendDir 'dist')) {
  Remove-Item (Join-Path $frontendDir 'dist') -Recurse -Force -ErrorAction SilentlyContinue
}

$buildExit = Invoke-HiddenCommand $frontendDir 'npm.cmd run build'
if ($buildExit -ne 0 -or -not (Test-Path $frontendDist)) {
  Show-Error 'Frontend build failed. Please check the frontend build.'
  exit 1
}

Stop-DashboardServer
Start-Sleep -Milliseconds 750

Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $backendDir -WindowStyle Hidden

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-DashboardRunning) {
    break
  }
}

if (-not (Test-DashboardRunning)) {
  Show-Error 'The dashboard server could not be started.'
  exit 1
}

$launchUrl = "$appUrl/?v=$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
Start-Process $launchUrl

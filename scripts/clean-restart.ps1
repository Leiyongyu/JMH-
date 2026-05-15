$ErrorActionPreference = "SilentlyContinue"

function Stop-DevNodeProcesses {
  $targets = Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'vite' -or
      $_.CommandLine -match 'nest start' -or
      $_.CommandLine -match 'concurrently'
    )
  }
  foreach ($p in $targets) {
    try {
      Stop-Process -Id $p.ProcessId -Force
      Write-Host "[CLEAN] Stopped node PID=$($p.ProcessId)"
    } catch {
      Write-Host "[CLEAN] Skip node PID=$($p.ProcessId)"
    }
  }
}

function Stop-PortProcess {
  param(
    [int]$Port
  )

  $pids = @()
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -ExpandProperty OwningProcess -Unique
  if ($conns) { $pids += $conns }

  # fallback: netstat (某些环境 Get-NetTCPConnection 不返回结果)
  $netstat = netstat -ano -p tcp | Select-String ":$Port\s+.*LISTENING\s+(\d+)$"
  foreach ($m in $netstat) {
    $pidText = ($m.Matches[0].Groups[1].Value)
    if ($pidText) { $pids += [int]$pidText }
  }

  $pids = $pids | Sort-Object -Unique
  foreach ($pid in $pids) {
    try {
      Stop-Process -Id $pid -Force
      Write-Host "[CLEAN] Stopped PID=$pid on port $Port"
    } catch {
      Write-Host "[CLEAN] Skip PID=$pid on port $Port"
    }
  }
}

Write-Host "[CLEAN] Stopping stale dev node processes..."
Stop-DevNodeProcesses

Write-Host "[CLEAN] Killing stale listeners on 3001 and 5173-5180..."
Stop-PortProcess -Port 3001
5173..5180 | ForEach-Object { Stop-PortProcess -Port $_ }

Write-Host "[START] Starting API + Web..."
pnpm dev

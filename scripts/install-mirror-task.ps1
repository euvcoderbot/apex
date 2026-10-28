<#
.SYNOPSIS
  Keeps the raw OpenF1 archive current: runs scripts/mirror-openf1.py --watch at logon.

.DESCRIPTION
  Registers the Windows scheduled task "ApexRawArchive" for the current user. The
  watcher follows the published F1 schedule (it sleeps until each session has
  settled, then archives it), so it uses almost nothing between sessions. It
  starts at logon and once a day (a second copy exits at once: only one watcher
  runs), restarts if it crashes, and appends to ~\apex-data\mirror-watch.log.

  Run it from the checkout the task should use. If that folder or its .venv is
  ever moved, run the script again from the new location.

    powershell -File scripts\install-mirror-task.ps1            install or update
    powershell -File scripts\install-mirror-task.ps1 -Remove    remove
    powershell -File scripts\install-mirror-task.ps1 -Python C:\path\to\python.exe
#>
param([switch]$Remove, [string]$Python)

$name = 'ApexRawArchive'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  "Removed $name."
  return
}

$root = Split-Path -Parent $PSScriptRoot
if (-not $Python) { $Python = Join-Path $root '.venv\Scripts\python.exe' }
if (-not (Test-Path $Python)) { throw "Python not found at $Python (pass -Python)." }
# The venv may be reached through folder links; register the real interpreter location.
$Python = & $Python -c "import sys, os; print(os.path.realpath(sys.executable))"
$log = Join-Path $HOME 'apex-data\mirror-watch.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

$command = "Set-Location -LiteralPath '$root'; & '$Python' scripts\mirror-openf1.py --watch *>> '$log'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $root `
  -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`""
$triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME), (New-ScheduledTaskTrigger -Daily -At 3am))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -Force `
  -Description 'Archives each finished F1 session from OpenF1 once it has settled (apex).' | Out-Null
"Registered $name"
"  python : $Python"
"  folder : $root"
"  log    : $log"
"Remove with: powershell -File scripts\install-mirror-task.ps1 -Remove"

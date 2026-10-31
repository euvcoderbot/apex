<# Install hidden calendar refresh and session-triggered archive tasks. #>
param([switch]$Refresh)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
$pythonw = Join-Path $root '.venv\Scripts\pythonw.exe'
$runner = Join-Path $root 'scripts\session-archive-scheduler.py'
if (!(Test-Path $python) -or !(Test-Path $pythonw)) { throw 'The release Python environment is missing.' }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 12)
$raw = & $python $runner plan
if ($LASTEXITCODE -ne 0) { throw 'Calendar query failed; existing session schedule was preserved.' }
$dates = ConvertFrom-Json -InputObject ($raw -join [Environment]::NewLine)
$triggers = @()
foreach ($value in $dates) {
  if (-not $value) { continue }
  $at = [DateTimeOffset]::Parse($value).LocalDateTime
  if ($at -le (Get-Date).AddHours(-9)) { continue }
  $triggers += New-ScheduledTaskTrigger -Once -At $at -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 9)
}
if ($triggers.Count -gt 0) {
  $action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"{0}" run' -f $runner) -WorkingDirectory $root
  Register-ScheduledTask -TaskName 'ApexSessionArchive' -Action $action -Trigger $triggers -Settings $settings -Force -Description 'Archives confirmed F1 sessions and retries delayed data.' | Out-Null
}
if (-not $Refresh) {
  $action = New-ScheduledTaskAction -Execute $pythonw -Argument ('"{0}" refresh' -f $runner) -WorkingDirectory $root
  $maintenance = @((New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME), (New-ScheduledTaskTrigger -Daily -At 3am))
  Register-ScheduledTask -TaskName 'ApexSessionScheduleRefresh' -Action $action -Trigger $maintenance -Settings $settings -Force -Description 'Refreshes session triggers silently and catches up missed sessions.' | Out-Null
}
Start-Process -FilePath $pythonw -ArgumentList ('"{0}" run' -f $runner) -WorkingDirectory $root -WindowStyle Hidden
Write-Output "Scheduled $($triggers.Count) upcoming sessions; this does not publish the site."

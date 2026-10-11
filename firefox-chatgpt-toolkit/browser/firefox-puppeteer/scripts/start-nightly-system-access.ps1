param([switch]$Check)

$ErrorActionPreference = 'Stop'
$nightlyExe = 'C:\Program Files\Firefox Nightly\firefox.exe'
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'NIGHTLY_PWSH_7_REQUIRED'
}
if (-not (Test-Path -LiteralPath $nightlyExe -PathType Leaf)) {
    throw 'NIGHTLY_EXECUTABLE_MISSING'
}
if (-not (Get-Command Start-Process).Parameters.ContainsKey('Environment')) {
    throw 'NIGHTLY_PROCESS_ENVIRONMENT_UNSUPPORTED'
}

$running = @(Get-CimInstance Win32_Process -Filter "Name = 'firefox.exe'" |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($nightlyExe, [StringComparison]::OrdinalIgnoreCase) })
if ($Check) {
    [pscustomobject]@{
        executable = $nightlyExe
        running = ($running.Count -gt 0)
        requiresNormalExit = ($running.Count -gt 0)
        systemAccessForCurrentProcess = 'unchanged'
        launchScope = 'Firefox Nightly process only'
    } | ConvertTo-Json -Compress
    exit 0
}
if ($running.Count -gt 0) {
    throw 'NIGHTLY_ALREADY_RUNNING_CLOSE_NORMALLY_FIRST'
}

# Firefox reads this value when the Remote Agent is constructed. Scope it to
# this one interactive browser process instead of modifying the user environment.
$started = Start-Process -FilePath $nightlyExe -Environment @{
    MOZ_REMOTE_ALLOW_SYSTEM_ACCESS = '1'
} -PassThru
if (-not $started -or $started.Id -le 0) {
    throw 'NIGHTLY_START_FAILED'
}
[pscustomobject]@{
    started = $true
    processId = $started.Id
    executable = $nightlyExe
    systemAccessConfiguredAtStartup = $true
    remoteControlMustBeEnabledInFirefox = $true
} | ConvertTo-Json -Compress

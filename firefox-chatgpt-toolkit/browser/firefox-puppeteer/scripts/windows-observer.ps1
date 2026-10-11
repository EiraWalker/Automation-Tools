param(
    [ValidateSet('endpoint','watch')][string]$Mode,
    [ValidateRange(1,65535)][int]$Port = 9222,
    [int]$BrowserProcessId,
    [string]$StopFile
)
$ErrorActionPreference = 'Stop'
try {
    if ($Mode -eq 'endpoint') {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($owners.Count -ne 1) {
            @{ listening = ($listeners.Count -gt 0); uniqueOwner = $false } | ConvertTo-Json -Compress
            exit 0
        }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($owners[0])"
        $version = if ($process.ExecutablePath) { (Get-Item -LiteralPath $process.ExecutablePath).VersionInfo.ProductVersion } else { $null }
        @{
            listening = $true; uniqueOwner = $true; processId = [int]$owners[0]
            loopbackOnly = (@($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') }).Count -eq 0)
            executablePath = $process.ExecutablePath; version = $version
            automationFlags = [bool]($process.CommandLine -match '(?i)--?(marionette|remote-debugging-port)(?:[=\s"]|$)')
        } | ConvertTo-Json -Compress
        exit 0
    }
    if ($BrowserProcessId -le 0) { throw 'BrowserProcessId required' }
    # Reuse only the read-only tab-strip selectors from the historical toolkit.
    Import-Module (Join-Path $PSScriptRoot '../../firefox-native-automation/scripts/FirefoxNative.psm1') -DisableNameChecking
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FirefoxObservation {
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    public struct Rect { public int Left, Top, Right, Bottom; }
}
'@
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $BrowserProcessId)
    $roots = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition) | Where-Object { $_.Current.ClassName -eq 'MozillaWindowClass' })
    if ($roots.Count -eq 0) { throw 'No browser windows found' }
    if (-not $StopFile) { throw 'StopFile required' }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $roots = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition) | Where-Object { $_.Current.ClassName -eq 'MozillaWindowClass' })
        if ($roots.Count -eq 0) { throw 'Browser windows disappeared' }
        $windows = @()
        $selectionReadable = $true
        foreach ($root in $roots) {
            $handle = [IntPtr]$root.Current.NativeWindowHandle
            $rect = New-Object FirefoxObservation+Rect
            if (-not [FirefoxObservation]::GetWindowRect($handle, [ref]$rect)) { throw 'Window disappeared' }
            try {
                $selected = @(Get-FirefoxTabs $root | Where-Object { Test-FirefoxTabSelected $_ })
                if ($selected.Count -ne 1) { throw 'Selection ambiguous' }
                $selection = $selected[0].GetRuntimeId() -join ':'
            } catch { $selectionReadable = $false; $selection = $null }
            $windows += @{
                hwnd = $handle.ToInt64().ToString(); selectedTab = $selection
                minimized = [FirefoxNativeWin32]::IsIconic($handle)
                bounds = @($rect.Left,$rect.Top,$rect.Right,$rect.Bottom)
            }
        }
        $sample = @{
            elapsedMs = $timer.ElapsedMilliseconds
            foreground = [FirefoxNativeWin32]::GetForegroundWindow().ToInt64().ToString()
            clipboardSequence = [FirefoxObservation]::GetClipboardSequenceNumber()
            selectionReadable = $selectionReadable; windows = $windows
        }
        $sample | ConvertTo-Json -Compress -Depth 5
        [Console]::Out.Flush()
        if (Test-Path -LiteralPath $StopFile) { break }
        Start-Sleep -Milliseconds 100
    } while ($timer.Elapsed.TotalSeconds -lt 120)
    if (-not (Test-Path -LiteralPath $StopFile)) { throw 'Observation expired before task completion' }
} catch {
    @{ error = 'F_WINDOWS_OBSERVER_FAILED' } | ConvertTo-Json -Compress
    exit 1
}

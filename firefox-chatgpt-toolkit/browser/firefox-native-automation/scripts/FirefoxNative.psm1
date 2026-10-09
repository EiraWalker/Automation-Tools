# SPDX-License-Identifier: MIT
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
if (-not ('FirefoxNativeWin32' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FirefoxNativeWin32 {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
 public struct Point { public int X; public int Y; public Point(int x,int y) { X=x; Y=y; } }
}
'@
}

function ConvertTo-FirefoxHandle([string]$Hwnd) {
    if ($Hwnd -notmatch '^0x[0-9a-fA-F]+$') { throw 'Hwnd must be a hexadecimal window handle, e.g. 0x123456.' }
    return [IntPtr][Convert]::ToInt64($Hwnd.Substring(2), 16)
}
function Find-FirefoxElements($Root, [string]$Property, $Value) {
    $propertyId = switch ($Property) {
        'Name' { [System.Windows.Automation.AutomationElement]::NameProperty }
        'AutomationId' { [System.Windows.Automation.AutomationElement]::AutomationIdProperty }
        'ControlType' { [System.Windows.Automation.AutomationElement]::ControlTypeProperty }
        default { throw 'Unsupported UI Automation property.' }
    }
    $condition = New-Object System.Windows.Automation.PropertyCondition($propertyId, $Value)
    return @($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
}
function Get-FirefoxTabs($Root) {
    # Webpages also expose TabItem controls, including background Slack pages.
    # Only the native browser tab strip can identify our operation target.
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'TabsToolbar')
    $toolbars = @($Root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition))
    if ($toolbars.Count -ne 1) { throw 'Native Firefox tabs toolbar is ambiguous.' }
    $strips = @(Find-FirefoxElements $toolbars[0] 'AutomationId' 'tabbrowser-tabs')
    if ($strips.Count -ne 1) { throw 'Native Firefox tab strip is ambiguous.' }
    return @(Find-FirefoxElements $strips[0] 'ControlType' ([System.Windows.Automation.ControlType]::TabItem))
}
function Test-FirefoxTabSelected($Tab) {
    return ([System.Windows.Automation.SelectionItemPattern]$Tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Current.IsSelected
}
function Get-FirefoxAddress($Root) {
    $elements = @(Find-FirefoxElements $Root 'AutomationId' 'urlbar-input')
    if ($elements.Count -ne 1) { throw 'Firefox address field is ambiguous.' }
    return ([System.Windows.Automation.ValuePattern]$elements[0].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value
}
function Test-FirefoxUrl([string]$Actual, [string]$Expected) {
    # Firefox omits https:// in an unfocused address field. Compare the complete URL.
    return (($Actual -replace '^https://', '') -ceq ($Expected -replace '^https://', ''))
}
function New-FirefoxContext([string]$Hwnd, [string]$ExpectedTab, [string]$ExpectedUrl) {
    $handle = ConvertTo-FirefoxHandle $Hwnd
    if (-not [FirefoxNativeWin32]::IsWindow($handle)) { throw 'Window no longer exists. Inspect again.' }
    [uint32]$ownerPid = 0
    [void][FirefoxNativeWin32]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
    if ((Get-Process -Id $ownerPid).ProcessName -ne 'firefox') { throw 'The specified HWND does not belong to Firefox.' }
    return @{ Handle = $handle; ExpectedTab = $ExpectedTab; ExpectedUrl = $ExpectedUrl }
}
function Assert-FirefoxTarget($Context, [switch]$Foreground, [switch]$AllowMinimized, [switch]$IgnoreAddress) {
    if (-not [FirefoxNativeWin32]::IsWindow($Context.Handle)) { throw 'Window no longer exists.' }
    if (-not $AllowMinimized -and [FirefoxNativeWin32]::IsIconic($Context.Handle)) { throw 'Window is minimized; this tool will not restore it.' }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($Context.Handle)
    $tabs = @(Get-FirefoxTabs $root | Where-Object { Test-FirefoxTabSelected $_ })
    if (-not $Context.ExpectedTab -or $tabs.Count -ne 1 -or $tabs[0].Current.Name -cne $Context.ExpectedTab) { throw 'Selected tab differs from ExpectedTab. No action performed.' }
    if (-not $IgnoreAddress -and $Context.ExpectedUrl -and -not (Test-FirefoxUrl (Get-FirefoxAddress $root) $Context.ExpectedUrl)) { throw 'Address differs from ExpectedUrl. Inspect the address draft before continuing.' }
    if ($Foreground -and [FirefoxNativeWin32]::GetForegroundWindow() -ne $Context.Handle) { throw 'Target lost foreground. No further input sent.' }
    return $root
}
function Activate-FirefoxTarget($Context) {
    # Validate first: an incorrect selector must not steal another window's focus.
    $null = Assert-FirefoxTarget $Context
    if ([FirefoxNativeWin32]::GetForegroundWindow() -eq $Context.Handle) {
        return Assert-FirefoxTarget $Context -Foreground
    }
    $thread = [FirefoxNativeWin32]::GetCurrentThreadId()
    [uint32]$ignoredPid = 0
    $foregroundThread = [FirefoxNativeWin32]::GetWindowThreadProcessId([FirefoxNativeWin32]::GetForegroundWindow(), [ref]$ignoredPid)
    $targetThread = [FirefoxNativeWin32]::GetWindowThreadProcessId($Context.Handle, [ref]$ignoredPid)
    try {
        [void][FirefoxNativeWin32]::AttachThreadInput($thread, $foregroundThread, $true)
        [void][FirefoxNativeWin32]::AttachThreadInput($thread, $targetThread, $true)
        [void][FirefoxNativeWin32]::SetForegroundWindow($Context.Handle)
    } finally {
        [void][FirefoxNativeWin32]::AttachThreadInput($thread, $targetThread, $false)
        [void][FirefoxNativeWin32]::AttachThreadInput($thread, $foregroundThread, $false)
    }
    return Assert-FirefoxTarget $Context -Foreground
}
function Wait-FirefoxCondition([scriptblock]$Condition, [int]$TimeoutMs = 2500) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 80
    } while ($timer.ElapsedMilliseconds -lt $TimeoutMs)
    throw 'Firefox UI did not reach the expected state before the deadline.'
}
function Get-FirefoxConsole($Root) {
    $frames = @(Find-FirefoxElements $Root 'AutomationId' 'toolbox-panel-iframe-webconsole' | Where-Object { -not $_.Current.IsOffscreen })
    if ($frames.Count -ne 1) { throw 'Exactly one visible Firefox Web Console is required.' }
    return $frames[0]
}
function Get-FirefoxConsoleInput($Root) {
    $frame = Get-FirefoxConsole $Root
    $inputs = @(Find-FirefoxElements $frame 'ControlType' ([System.Windows.Automation.ControlType]::Edit) | Where-Object { $_.Current.Name -eq '' })
    if ($inputs.Count -ne 1) { throw 'Firefox console input is ambiguous.' }
    return $inputs[0]
}
function Get-FirefoxConsoleCode($Root) {
    $inputElement = Get-FirefoxConsoleInput $Root
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $node = $inputElement
    for ($i = 0; $i -lt 6 -and $node; $i++) {
        if ($node.Current.ClassName -match '^CodeMirror(?: |$)') {
            # Firefox's hidden CodeMirror textarea is empty even when the editor
            # contains code. Read its syntax text nodes, excluding only the
            # screen-reader padding at the start/end of the rendered line.
            $tokens = @(Find-FirefoxElements $node 'ControlType' ([System.Windows.Automation.ControlType]::Text) | ForEach-Object { $_.Current.Name })
            return ($tokens -join '').TrimStart([char]0xA0).TrimEnd([char]0x200B)
        }
        $node = $walker.GetParent($node)
    }
    return ([System.Windows.Automation.ValuePattern]$inputElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value
}
function Focus-FirefoxElement($Context, $Element) {
    $null = Assert-FirefoxTarget $Context -Foreground
    $Element.SetFocus()
    $id = $Element.GetRuntimeId() -join ','
    Wait-FirefoxCondition {
        $null = Assert-FirefoxTarget $Context -Foreground
        return (([System.Windows.Automation.AutomationElement]::FocusedElement.GetRuntimeId() -join ',') -eq $id)
    }
}
function Send-FirefoxKeys($Context, $Element, [string]$Keys) {
    Focus-FirefoxElement $Context $Element
    $null = Assert-FirefoxTarget $Context -Foreground
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
}
function Normalize-FirefoxCode([string]$Code) { return ($Code -replace "`r`n", "`n").TrimEnd("`r", "`n") }
function Get-FirefoxCodeHash([string]$Code) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes((Normalize-FirefoxCode $Code))))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
}
function Get-FirefoxInventory {
    # Enumerate every top-level window; MainWindowHandle misses extra Firefox windows.
    $desktop = [System.Windows.Automation.AutomationElement]::RootElement
    foreach ($root in $desktop.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
        if ($root.Current.ClassName -ne 'MozillaWindowClass') { continue }
        try {
            $handle = [IntPtr]$root.Current.NativeWindowHandle
            $selected = @(Get-FirefoxTabs $root | Where-Object { Test-FirefoxTabSelected $_ })
            [pscustomobject]@{
                hwnd = ('0x{0:X}' -f $handle.ToInt64()); pid = $root.Current.ProcessId
                title = $root.Current.Name; minimized = [FirefoxNativeWin32]::IsIconic($handle)
                foreground = ([FirefoxNativeWin32]::GetForegroundWindow() -eq $handle)
                selectedTab = if ($selected.Count -eq 1) { $selected[0].Current.Name } else { $null }
                address = Get-FirefoxAddress $root
                tabs = @(Get-FirefoxTabs $root | ForEach-Object { [pscustomobject]@{ name = $_.Current.Name; selected = (Test-FirefoxTabSelected $_) } })
            }
        } catch { Write-Verbose 'A Firefox window changed during inspection; inspect again.' }
    }
}
function Read-FirefoxConsole($Context, [string]$Sentinel) {
    if ($Sentinel -notmatch '^[A-Za-z][A-Za-z0-9_-]{2,79}$') { throw 'Use a short alphanumeric sentinel, such as CHECK_20261006_01.' }
    $root = Assert-FirefoxTarget $Context -AllowMinimized
    $frame = Get-FirefoxConsole $root
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $elements = @($frame) + @($frame.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
    $pattern = '^(?:\uFFFC|\s)*(?:Expand |Collapse )?' + [regex]::Escape($Sentinel) + ' '
    foreach ($element in $elements) {
        if ($element.Current.Name -match $pattern) { $lines.Add($element.Current.Name) }
        $textPattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
            foreach ($line in ([System.Windows.Automation.TextPattern]$textPattern).DocumentRange.GetText(-1) -split "`n") {
                if ($line -match $pattern) { $lines.Add($line.Trim()) }
            }
        }
    }
    return @($lines | Select-Object -Unique | Select-Object -Last 16)
}
Export-ModuleMember -Function *-Firefox*

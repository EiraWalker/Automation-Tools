# SPDX-License-Identifier: MIT
[CmdletBinding()]
param(
 [Parameter(Mandatory)][ValidateSet('Inspect','SelectTab','NewTab','CloseTab','Navigate','Reload','OpenConsole','CloseConsole','ConsoleWrite','ConsoleExecute','ReadConsole','SendKeys','Invoke')][string]$Action,
 [string]$Hwnd, [string]$ExpectedTab, [string]$ExpectedUrl,
 [string]$TabName, [string]$Url, [string]$File, [string]$ConsoleSha256,
 [switch]$ReplaceConsole, [string]$Sentinel,
 [ValidateSet('Chrome','Console','Editor')][string]$Focus,
 [string]$EditorName = 'Ask ChatGPT', [string]$Keys,
 [string]$AutomationId, [string]$ElementName, [string]$ScopeId,
 [string]$RunButtonName = 'Run'
)
$ErrorActionPreference = 'Stop'
try {
 Import-Module "$PSScriptRoot/FirefoxNative.psm1" -Force -DisableNameChecking
 if ($Action -eq 'Inspect') {
  @{ ok = $true; windows = @(Get-FirefoxInventory) } | ConvertTo-Json -Depth 8 -Compress
  exit 0
 }
 $context = New-FirefoxContext $Hwnd $ExpectedTab $ExpectedUrl
 if ($Action -eq 'ReadConsole') {
  @{ ok = $true; sentinel = $Sentinel; lines = @(Read-FirefoxConsole $context $Sentinel) } | ConvertTo-Json -Depth 5 -Compress
  exit 0
 }
 $root = Activate-FirefoxTarget $context
 function UniqueElement($Elements) {
  $elementsArray = @($Elements)
  if ($elementsArray.Count -ne 1) { throw 'Element selector must match exactly one element.' }
  return $elementsArray[0]
 }
 function InvokeElement($Element) {
  $null = Assert-FirefoxTarget $context -Foreground
  ([System.Windows.Automation.InvokePattern]$Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
 }
 $result = @{ ok = $true; action = $Action }
 switch ($Action) {
  'SelectTab' {
   if (-not $TabName) { throw 'TabName is required.' }
   $tab = UniqueElement (@(Get-FirefoxTabs $root | Where-Object { $_.Current.Name -ceq $TabName }))
   ([System.Windows.Automation.SelectionItemPattern]$tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)).Select()
   $context.ExpectedTab = $TabName; $context.ExpectedUrl = ''
   Wait-FirefoxCondition {
    if ([FirefoxNativeWin32]::GetForegroundWindow() -ne $context.Handle) { throw 'Target lost foreground.' }
    $r = [System.Windows.Automation.AutomationElement]::FromHandle($context.Handle)
    $selected = @(Get-FirefoxTabs $r | Where-Object { Test-FirefoxTabSelected $_ })
    return $selected.Count -eq 1 -and $selected[0].Current.Name -ceq $TabName
   }
   $null = Assert-FirefoxTarget $context -Foreground
   $result.selectedTab = $TabName
  }
  'NewTab' {
   $previousIds = @(Get-FirefoxTabs $root | ForEach-Object { $_.GetRuntimeId() -join ',' })
   InvokeElement (UniqueElement (Find-FirefoxElements $root 'AutomationId' 'tabs-newtab-button'))
   Wait-FirefoxCondition {
    if ([FirefoxNativeWin32]::GetForegroundWindow() -ne $context.Handle) { throw 'Target lost foreground.' }
    $r = [System.Windows.Automation.AutomationElement]::FromHandle($context.Handle)
    $selected = @(Get-FirefoxTabs $r | Where-Object { Test-FirefoxTabSelected $_ })
    return $selected.Count -eq 1 -and ($selected[0].GetRuntimeId() -join ',') -notin $previousIds
   }
   $r = [System.Windows.Automation.AutomationElement]::FromHandle($context.Handle)
   $result.selectedTab = (@(Get-FirefoxTabs $r | Where-Object { Test-FirefoxTabSelected $_ }))[0].Current.Name
  }
  'CloseTab' {
   if (-not $TabName) { throw 'TabName is required; no whole-window close operation exists.' }
   $tab = UniqueElement (@(Get-FirefoxTabs $root | Where-Object { $_.Current.Name -ceq $TabName }))
   InvokeElement (UniqueElement (Find-FirefoxElements $tab 'ControlType' ([System.Windows.Automation.ControlType]::Button)))
   $result.closedTab = $TabName
  }
  'Navigate' {
   if (-not $Url) { throw 'Url is required.' }
   $address = UniqueElement (Find-FirefoxElements $root 'AutomationId' 'urlbar-input')
   Focus-FirefoxElement $context $address
   ([System.Windows.Automation.ValuePattern]$address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($Url)
   Wait-FirefoxCondition { return (Get-FirefoxAddress $root) -ceq $Url }
   $context.ExpectedUrl = $Url
   Send-FirefoxKeys $context $address '{ENTER}'
   $result.navigationRequested = $true
  }
  'Reload' {
   $address = UniqueElement (Find-FirefoxElements $root 'AutomationId' 'urlbar-input')
   # Console Ctrl+R can be intercepted. Focus browser chrome before the shortcut.
   Send-FirefoxKeys $context $address '^r'
   $result.reloadRequested = $true
  }
  'OpenConsole' {
   $visible = @(Find-FirefoxElements $root 'AutomationId' 'toolbox-panel-iframe-webconsole' | Where-Object { -not $_.Current.IsOffscreen })
   if ($visible.Count -eq 0) {
    $address = UniqueElement (Find-FirefoxElements $root 'AutomationId' 'urlbar-input')
    Send-FirefoxKeys $context $address '^+k'
    Wait-FirefoxCondition {
     $r = Assert-FirefoxTarget $context -Foreground
     return @(Find-FirefoxElements $r 'AutomationId' 'toolbox-panel-iframe-webconsole' | Where-Object { -not $_.Current.IsOffscreen }).Count -eq 1
    }
   } elseif ($visible.Count -ne 1) { throw 'Visible console is ambiguous.' }
  }
  'CloseConsole' {
   $buttons = @(Find-FirefoxElements $root 'AutomationId' 'toolbox-close' | Where-Object { -not $_.Current.IsOffscreen })
   if ($buttons.Count -eq 1) { InvokeElement $buttons[0] }
   elseif ($buttons.Count -gt 1) { throw 'Close-console control is ambiguous.' }
  }
  'ConsoleWrite' {
   if (-not $File) { throw 'File is required.' }
   $source = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $File).Path, [Text.Encoding]::UTF8)
   $inputElement = Get-FirefoxConsoleInput $root
   $valuePattern = [System.Windows.Automation.ValuePattern]$inputElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
   if ($valuePattern.Current.Value.Trim() -and -not $ReplaceConsole) { throw 'Console already contains text. Inspect it or use ReplaceConsole for an authorized replacement.' }
   Send-FirefoxKeys $context $inputElement '^a{BACKSPACE}'
   $valuePattern.SetValue($source)
   Wait-FirefoxCondition { return (Normalize-FirefoxCode $valuePattern.Current.Value) -ceq (Normalize-FirefoxCode $source) }
   $result.consoleSha256 = Get-FirefoxCodeHash $source
   $result.characters = $source.Length
   $result.executed = $false
  }
  'ConsoleExecute' {
   if ($ConsoleSha256 -notmatch '^[a-f0-9]{64}$') { throw 'ConsoleSha256 from ConsoleWrite is required.' }
   $inputElement = Get-FirefoxConsoleInput $root
   $valuePattern = [System.Windows.Automation.ValuePattern]$inputElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
   if ((Get-FirefoxCodeHash $valuePattern.Current.Value) -cne $ConsoleSha256) { throw 'Console text changed after preparation. Execution cancelled.' }
   $frame = Get-FirefoxConsole $root
   $run = @(Find-FirefoxElements $frame 'Name' $RunButtonName | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and -not $_.Current.IsOffscreen })
   if ($run.Count -eq 0) {
    Focus-FirefoxElement $context $inputElement
    if ((Get-FirefoxCodeHash $valuePattern.Current.Value) -cne $ConsoleSha256) { throw 'Console text changed. Execution cancelled.' }
    $null = Assert-FirefoxTarget $context -Foreground
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
   }
   elseif ($run.Count -eq 1) {
    $rectangle = $run[0].Current.BoundingRectangle
    $x = [int]($rectangle.Left + $rectangle.Width / 2); $y = [int]($rectangle.Top + $rectangle.Height / 2)
    if (-not [System.Windows.Forms.SystemInformation]::VirtualScreen.Contains($x, $y)) { throw 'Console Run button is outside the desktop. Use inline console mode or reposition the window yourself.' }
    $null = Assert-FirefoxTarget $context -Foreground
    [void][FirefoxNativeWin32]::SetCursorPos($x, $y)
    $hit = [FirefoxNativeWin32]::WindowFromPoint((New-Object FirefoxNativeWin32+Point($x, $y)))
    if ([FirefoxNativeWin32]::GetAncestor($hit, 2) -ne $context.Handle) { throw 'Another window covers the Run button. No click sent.' }
    $null = Assert-FirefoxTarget $context -Foreground
    if ((Get-FirefoxCodeHash $valuePattern.Current.Value) -cne $ConsoleSha256) { throw 'Console text changed. Execution cancelled.' }
    [FirefoxNativeWin32]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [FirefoxNativeWin32]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
   } else { throw 'Console Run button is ambiguous.' }
   $result.executionRequested = $true
  }
  'SendKeys' {
   if (-not $Focus -or -not $Keys) { throw 'Focus and Keys are required.' }
   $element = switch ($Focus) {
    'Chrome' { UniqueElement (Find-FirefoxElements $root 'AutomationId' 'urlbar-input') }
    'Console' { Get-FirefoxConsoleInput $root }
    'Editor' { UniqueElement (@(Find-FirefoxElements $root 'Name' $EditorName | Where-Object { -not $_.Current.IsOffscreen })) }
   }
   Send-FirefoxKeys $context $element $Keys
  }
  'Invoke' {
   if ([bool]$AutomationId -eq [bool]$ElementName) { throw 'Specify one AutomationId or ElementName.' }
   $scope = if ($ScopeId) { UniqueElement (Find-FirefoxElements $root 'AutomationId' $ScopeId) } else { $root }
   $element = if ($AutomationId) { UniqueElement (Find-FirefoxElements $scope 'AutomationId' $AutomationId) } else { UniqueElement (Find-FirefoxElements $scope 'Name' $ElementName) }
   InvokeElement $element
   $result.invokeRequested = $true
  }
 }
 $result | ConvertTo-Json -Depth 5 -Compress
} catch {
 @{ ok = $false; action = $Action; error = $_.Exception.Message } | ConvertTo-Json -Compress
 exit 1
}

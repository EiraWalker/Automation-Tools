param([switch]$LiveReadOnly)
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot/../scripts/FirefoxNative.psm1" -Force -DisableNameChecking
function Check([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
foreach ($file in Get-ChildItem "$PSScriptRoot/../scripts" -Include *.ps1,*.psm1 -Recurse) {
 $tokens = $null; $errors = $null
 [void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
 Check ($errors.Count -eq 0) 'PowerShell parse failed.'
}
Check (Test-FirefoxUrl 'chatgpt.com/c/test' 'https://chatgpt.com/c/test') 'HTTPS display normalization failed.'
Check (-not (Test-FirefoxUrl 'chatgpt.com/c/test-other' 'https://chatgpt.com/c/test')) 'URL prefix accepted.'
Check (-not (Test-FirefoxUrl 'http://chatgpt.com/c/test' 'https://chatgpt.com/c/test')) 'HTTP downgrade accepted.'
Check ((Get-FirefoxCodeHash "one`r`ntwo`r`n") -eq (Get-FirefoxCodeHash "one`ntwo")) 'Code normalization failed.'
Check ((Get-FirefoxCodeHash 'one') -ne (Get-FirefoxCodeHash 'two')) 'Different console code has the same hash.'
$invalidRejected = $false
try { $null = ConvertTo-FirefoxHandle '123' } catch { $invalidRejected = $true }
Check $invalidRejected 'Non-hex handle accepted.'
$live = @{ requested = [bool]$LiveReadOnly; windows = 0; mismatchRejected = $null }
if ($LiveReadOnly) {
 $foreground = [FirefoxNativeWin32]::GetForegroundWindow()
 $windows = @(Get-FirefoxInventory); $live.windows = $windows.Count
 Check ([FirefoxNativeWin32]::GetForegroundWindow() -eq $foreground) 'Read-only inspection changed foreground.'
 if ($windows.Count -gt 0) {
  $context = New-FirefoxContext $windows[0].hwnd '__INTENTIONALLY_WRONG_TEST_TAB__' ''
  $rejected = $false
  try { $null = Activate-FirefoxTarget $context } catch { $rejected = $true }
  Check $rejected 'Wrong target was accepted.'
  Check ([FirefoxNativeWin32]::GetForegroundWindow() -eq $foreground) 'Wrong target changed foreground.'
  $live.mismatchRejected = $true
 }
}
@{ok=$true;checks=8;live=$live} | ConvertTo-Json -Compress

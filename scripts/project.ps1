param(
 [ValidateSet('install','verify','native-readonly','firefox-doctor','firefox-environment','firefox-inspect')][string]$Phase = 'verify',
 [string]$AutomationSkill = (Join-Path $env:USERPROFILE '.codex\skills\project-dev-automation'),
 [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $AutomationSkill 'scripts\automation.py'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
 throw 'project-dev-automation is required; pass its installed directory with -AutomationSkill.'
}
& $Python -X utf8 $runner run --root $projectRoot --phase $Phase
exit $LASTEXITCODE

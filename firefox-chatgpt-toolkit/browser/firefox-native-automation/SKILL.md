---
name: firefox-native-automation
description: Operate an existing Firefox window on Windows using guarded UIAutomation, prepare and execute Web Console tasks, update Tampermonkey scripts, and preserve drafts. Use for real logged-in Firefox validation or attaching a local MCP bridge to an already-running session.
---

# Existing Firefox automation

Use the module's scripts relative to this SKILL.md. Start with `scripts/firefox-native.ps1 -Action Inspect`; choose an exact window HWND and named tab from the current inventory. Keep the user's existing Firefox profile and session. Do not infer authorization to launch, restart, or create a separate browser from a request to inspect a page.

For native operation, read [README.md](README.md). Every mutating command needs `-Hwnd` and `-ExpectedTab`; provide `-ExpectedUrl` when the address field is a confirmed URL. `SelectTab` checks the currently selected tab before selecting `-TabName`. Duplicate names are rejected. Refresh inventory after the user changes tabs or a command loses focus. The helper activates the selected window for input; it never restores a minimized window.

For page tasks, read [references/page-workflow.md](references/page-workflow.md). Guard the payload with the actual `document.title` and `location.href`; the address bar alone may contain an unsubmitted draft. Use `--inline` generated tasks with `ConsoleWrite -PasteConsole` for current CodeMirror. A hidden textarea Value can stay empty even when visible code exists; readback must verify the rendered editor, and a hash mismatch stops execution. Keep arbitrary payloads single-line; never flatten comments or use eval/base64-eval to bypass CSP. Encode userscript source as data, as the generator does. Use a unique sentinel, `ConsoleWrite`, its returned SHA-256, then a separate `ConsoleExecute`. Read the sentinel with `ReadConsole`. A save/click/execute request confirms dispatch only; confirm installed script metadata and real page behavior separately.

Preserve a native composer draft before authorized UI testing. Restoration refuses a different new draft. Do not execute a generated payload on another document or retry an uncertain message send automatically. Focus browser chrome before Web Console or reload shortcuts: CodeMirror and the Console can intercept them.

Use [references/mcp-bridge.md](references/mcp-bridge.md) only when the task calls for MCP and attaching to the existing browser is authorized. The bridge requires an already-configured Marionette/BiDi session and keeps global Codex configuration unchanged. The local file RPC records uncertain operations without replaying them; a pending response is polled by its existing request ID.

For background screenshots, use the companion background-window-capture module if available; inspect the image before claiming visible UI success. Do not substitute a newly launched browser or a DOM fixture for requested real-site validation.

Windows PowerShell 5.1 reads UTF-8 scripts without a BOM as the legacy code page. For local helper files containing non-ASCII tab names, save UTF-8 with BOM or invoke PowerShell 7; otherwise an exact target guard can correctly reject a misdecoded name. Never remove the guard to work around encoding.

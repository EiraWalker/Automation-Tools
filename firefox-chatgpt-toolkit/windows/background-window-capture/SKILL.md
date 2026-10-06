---
name: background-window-capture
description: Capture an already-running Windows application in the background with AgentCapture WGC or PrintWindow, identify an exact HWND, and verify the returned screenshot without activating or restoring the target window.
---

# Background window capture

Use `scripts/invoke.py` relative to this SKILL.md. Resolve an existing AgentCapture installation with `--tool`, `AGENTCAPTURE_EXE`, local config or PATH; read [README.md](README.md) for setup. This folder includes an adapter, not the executable.

1. Run `list --title '<target name>'` and disambiguate by exact HWND/PID. Multiple windows with similar titles require a specific HWND from the current inventory.
2. Capture with `capture --hwnd <current HWND> --method wgc --output <absolute PNG path>`. WGC supports a visible, non-minimized window even when covered. Keep the user's window position, foreground and minimized state.
3. Parse `ok` and exit code, actual `method`, dimensions, warnings and `foreground` record. Inspect the returned PNG before claiming it contains the requested page or current UI state.

Use `printwindow` only as an explicit compatibility attempt; a minimized/hidden target may yield a stale or small surface. `auto` permits WGC → PrintWindow fallback, with the actual backend reported. A state failure does not authorize restoring, moving or activating a window. Stop repeating an unchanged failure.

Output is local and may contain private page content; choose a task output location and keep images out of this repository. Existing files require an intentional `--overwrite`. Read [references/protocol.md](references/protocol.md) for result fields and failure handling. `contentVerified:false` means capture/encoding success alone is insufficient UI evidence.

"""AgentCapture process adapter. Python standard library; no shell or input injection."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def fail(code: str, message: str, exit_code: int) -> int:
    payload = {"schemaVersion": 1, "ok": False, "error": {"code": code, "message": message, "exitCode": exit_code}}
    sys.stdout.buffer.write((json.dumps(payload, ensure_ascii=True) + "\n").encode("utf-8"))
    return exit_code


def executable(override: str | None) -> Path:
    skill = Path(__file__).resolve().parent.parent
    configured = override or os.environ.get("AGENTCAPTURE_EXE")
    config = skill / "config.local.json"
    if not configured and config.is_file():
        configured = json.loads(config.read_text(encoding="utf-8-sig")).get("executable")
        if not isinstance(configured, str) or not configured.strip():
            raise ValueError("config.local.json requires a nonempty executable string.")
    if configured:
        path = Path(os.path.expandvars(configured)).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Configured AgentCapture executable does not exist: {path}")
        return path
    on_path = shutil.which("AgentCapture.exe")
    if on_path:
        return Path(on_path)
    candidate = skill.parent.parent / "bin" / "win-x64" / "AgentCapture.exe"
    if candidate.is_file():
        return candidate
    raise FileNotFoundError("Set AGENTCAPTURE_EXE or config.local.json executable, or build AgentCapture first.")


def main(arguments: list[str]) -> int:
    if os.name != "nt":
        return fail("unsupported_os", "AgentCapture requires Windows.", 2)
    override = None
    if arguments and arguments[0] == "--tool":
        if len(arguments) < 2:
            return fail("invalid_arguments", "--tool requires an executable path.", 2)
        override, arguments = arguments[1], arguments[2:]
    try:
        tool = executable(override)
        seconds = 13.0
        if "--timeout-ms" in arguments:
            index = arguments.index("--timeout-ms")
            try:
                seconds = min(125.0, max(13.0, int(arguments[index + 1]) / 1000.0 + 5.0))
            except (IndexError, ValueError):
                pass  # The native CLI returns its own argument diagnostic.
        process = subprocess.run([str(tool), *arguments], capture_output=True, timeout=seconds,
                                 creationflags=subprocess.CREATE_NO_WINDOW, shell=False)
        parsed = json.loads(process.stdout.decode("utf-8-sig"))
        if not isinstance(parsed, dict) or not isinstance(parsed.get("ok"), bool):
            return fail("invalid_tool_response", "AgentCapture did not return a JSON result envelope.", 5)
        sys.stdout.buffer.write(process.stdout.rstrip(b"\r\n") + b"\n")
        return process.returncode
    except FileNotFoundError as error:
        return fail("tool_not_found", str(error), 2)
    except subprocess.TimeoutExpired:
        return fail("timeout", "AgentCapture process exceeded its outer deadline.", 4)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        return fail("invalid_configuration_or_response", str(error), 5)
    except (OSError, ValueError) as error:
        return fail("tool_launch_failed", str(error), 5)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

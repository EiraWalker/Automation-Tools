"""Run the project's existing checks with positive test counts."""
from pathlib import Path
import argparse,re,subprocess,sys,unittest
ROOT=Path(__file__).resolve().parents[1]
def under_root(value):
    p=(ROOT/value).resolve()
    if not p.is_relative_to(ROOT) or not p.is_dir(): raise ValueError("Expected an existing project directory")
    return p
def node_tests(value):
    cwd=under_root(value)
    if (cwd/"build.cjs").is_file(): subprocess.run(["node","build.cjs"],cwd=cwd,check=True)
    files=sorted((cwd/"tests").glob("*.test.*"))
    if not files: raise ValueError("No test files")
    r=subprocess.run(["node","--test","--test-reporter=tap",*[str(p) for p in files]],cwd=cwd,capture_output=True,text=True,encoding="utf-8",errors="replace")
    sys.stdout.write(r.stdout);sys.stderr.write(r.stderr)
    counts=dict((k,int(v)) for k,v in re.findall(r"^# (tests|pass|fail|cancelled|skipped) (\d+)$",r.stdout,re.M))
    if r.returncode or counts.get("tests",0)==0 or counts.get("pass")!=counts.get("tests") or any(counts.get(k,0) for k in ("fail","cancelled","skipped")): raise ValueError("Incomplete or unsuccessful Node tests")
    return {"tests":counts["tests"],"passed":counts["pass"]}
def capture_tests():
    suite=unittest.defaultTestLoader.discover(str(ROOT/"firefox-chatgpt-toolkit/windows/background-window-capture/tests"))
    if not suite.countTestCases(): raise ValueError("No capture tests")
    r=unittest.TextTestRunner(verbosity=2).run(suite)
    if not r.wasSuccessful() or r.skipped: raise ValueError("Incomplete or unsuccessful capture tests")
    return {"tests":r.testsRun,"passed":r.testsRun}
def docs():
    import json
    required=[ROOT/"CONTEXT.md",ROOT/"AGENTS.md"]
    folder=ROOT/"firefox-chatgpt-toolkit/docs"
    required += [folder/p for p in ["CONTEXT.md","development.md","architecture.md","migration-2026-10-10.md","adr/README.md"]]
    required += [folder/"adr"/name for name in [
        "0001-userscript-local-dom.md", "0002-native-composer-fifo.md",
        "0003-receipt-active-errors.md", "0004-state-and-ownership.md",
        "0005-work-codex-adapters.md", "0006-native-theme-layout.md",
        "0007-workspace-source-authority.md",
    ]]
    if any(not p.is_file() for p in required): raise ValueError("Project documents missing")
    required = sorted(set(required) | set(folder.rglob("*.md")))
    broken=[]
    for p in required:
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)",p.read_text(encoding="utf-8")):
            target=target.strip().strip("<>").split("#",1)[0]
            if not target or re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:",target): continue
            if not (p.parent/target).resolve().exists(): broken.append(f"{p.relative_to(ROOT)}: {target}")
    if broken: raise ValueError("Broken document links: "+repr(broken))
    for phase in json.loads((ROOT/"automation.json").read_text(encoding="utf-8"))["phases"].values():
        for step in phase["steps"]: under_root(step.get("cwd","."))
    return {"documents":len(required),"brokenLinks":0}
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("action",choices=["node-tests","capture-tests","docs"]);p.add_argument("directory",nargs="?");args=p.parse_args()
    try:
        result=node_tests(args.directory) if args.action=="node-tests" else capture_tests() if args.action=="capture-tests" else docs()
        print(result);return 0
    except (OSError,ValueError,subprocess.CalledProcessError) as e: print(f"FAILED: {e}",file=sys.stderr);return 1
if __name__=="__main__":raise SystemExit(main())

import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('capture_adapter', Path(__file__).resolve().parents[1] / 'scripts' / 'invoke.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class AdapterTests(unittest.TestCase):
    def invoke(self, result=None, error=None, args=None):
        output = SimpleNamespace(buffer=io.BytesIO())
        with patch.object(adapter, 'executable', return_value=Path('AgentCapture.exe')), patch.object(adapter.sys, 'stdout', output), patch.object(adapter.subprocess, 'run', return_value=result, side_effect=error) as runner:
            code = adapter.main(args or ['version'])
        return code, json.loads(output.buffer.getvalue()), runner

    def test_valid_response_uses_no_shell_and_preserves_exit_code(self):
        payload = {'schemaVersion': 1, 'ok': False, 'error': {'code': 'window_not_capturable'}}
        code, result, runner = self.invoke(SimpleNamespace(stdout=json.dumps(payload).encode(), returncode=3))
        self.assertEqual(code, 3)
        self.assertEqual(result, payload)
        self.assertFalse(runner.call_args.kwargs['shell'])
        self.assertTrue(runner.call_args.kwargs['creationflags'] & subprocess.CREATE_NO_WINDOW)

    def test_invalid_envelope(self):
        code, result, _ = self.invoke(SimpleNamespace(stdout=b'{"output":"file.png"}', returncode=0))
        self.assertEqual(code, 5)
        self.assertEqual(result['error']['code'], 'invalid_tool_response')

    def test_invalid_json(self):
        code, result, _ = self.invoke(SimpleNamespace(stdout=b'not json', returncode=0))
        self.assertEqual(code, 5)
        self.assertFalse(result['ok'])

    def test_outer_timeout(self):
        code, result, _ = self.invoke(error=subprocess.TimeoutExpired('capture', 13))
        self.assertEqual(code, 4)
        self.assertEqual(result['error']['code'], 'timeout')

    def test_capture_timeout_budget_is_bounded(self):
        _, _, runner = self.invoke(SimpleNamespace(stdout=b'{"ok":true}', returncode=0), args=['capture', '--timeout-ms', '200000'])
        self.assertEqual(runner.call_args.kwargs['timeout'], 125)

    def test_missing_override_value(self):
        output = SimpleNamespace(buffer=io.BytesIO())
        with patch.object(adapter.sys, 'stdout', output):
            self.assertEqual(adapter.main(['--tool']), 2)
        self.assertEqual(json.loads(output.buffer.getvalue())['error']['code'], 'invalid_arguments')

    def test_explicit_executable_resolution_and_missing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            exe = Path(directory) / 'AgentCapture.exe'
            exe.write_bytes(b'test placeholder')
            self.assertEqual(adapter.executable(str(exe)), exe.resolve())
            with self.assertRaises(FileNotFoundError):
                adapter.executable(str(exe.with_name('missing.exe')))

if __name__ == '__main__':
    unittest.main()

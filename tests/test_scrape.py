import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("infra", ROOT / "scripts/scrape-infrastructure.py")
infra = importlib.util.module_from_spec(spec)
spec.loader.exec_module(infra)


class InfrastructureTests(unittest.TestCase):
    def test_never_delete_unowned_droplet(self):
        with patch.object(infra, "api", return_value={"droplet": {"tags": ["production"]}}) as api:
            with self.assertRaises(ValueError):
                infra.delete(596178744)
            self.assertEqual(api.call_count, 1)

    def test_late_completion_cannot_delete_new_run(self):
        with patch.object(infra, "api", return_value={"droplet": {"tags": [infra.TAG, "scrape-run-2-1"]}}) as api:
            with self.assertRaises(ValueError):
                infra.delete(123, "1-1")
            self.assertEqual(api.call_count, 1)

    def test_delete_confirms_absence_and_is_idempotent(self):
        with patch.object(infra, "api", side_effect=[{"droplet": {"tags": [infra.TAG, "scrape-run-1-1"]}}, None, None]) as api:
            infra.delete(123, "1-1")
            self.assertEqual(api.call_args_list[1].args, ("DELETE", "droplets/123"))
        with patch.object(infra, "api", return_value=None) as api:
            infra.delete(123, "1-1")
            self.assertEqual(api.call_count, 1)

    def test_deletion_timeout_fails_closed(self):
        with patch.object(infra, "api", return_value={"droplet": {"tags": [infra.TAG]}}), patch.object(infra.time, "sleep"):
            with self.assertRaises(RuntimeError):
                infra.delete(123)


class ScrapeTests(unittest.TestCase):
    def test_failure_publishes_nothing_and_success_commits_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, worker, other = (root / name for name in ("remote.git", "worker", "other"))
            def git(cwd, *args):
                return subprocess.check_output(["git", "-C", str(cwd), *args], text=True, stderr=subprocess.DEVNULL).strip()
            subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(remote)], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["git", "clone", str(remote), str(worker)], check=True, stderr=subprocess.DEVNULL)
            git(worker, "config", "user.name", "Test")
            git(worker, "config", "user.email", "test@example.com")
            (worker / "scripts").mkdir()
            (worker / "scripts/scrape.sh").write_bytes((ROOT / "scripts/scrape.sh").read_bytes())
            raw = worker / "data/raw/2026-10-21.jsonl"
            raw.parent.mkdir(parents=True)
            raw.write_text('{"id":1,"jsonld":[]}\n')
            (worker / "README").write_text("initial")
            git(worker, "add", ".")
            git(worker, "commit", "-m", "Initial")
            git(worker, "push", "origin", "main")
            subprocess.run(["git", "clone", str(remote), str(other)], check=True, stderr=subprocess.DEVNULL)
            git(other, "config", "user.name", "Other")
            git(other, "config", "user.email", "other@example.com")
            (other / "README").write_text("independent")
            git(other, "commit", "-am", "Independent change")
            git(other, "push", "origin", "main")
            tools = root / "tools"
            tools.mkdir()
            stub = """#!/usr/bin/env python3
import os, sys
from pathlib import Path
if Path(sys.argv[0]).name == 'timeout':
    os.execvp(sys.argv[4], sys.argv[4:])
if sys.argv[1:] == ['run', 'scrape']:
    if os.environ.get('FAIL_SCRAPE'):
        sys.exit(1)
    if os.environ.get('NEW_DATA'):
        with open('data/raw/2026-10-21.jsonl','a') as stream:
            stream.write('{"id":2,"jsonld":[]}\\n')
"""
            for name in ("npm", "timeout"):
                tool = tools / name
                tool.write_text(stub)
                tool.chmod(0o755)
            env = {**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"], "SCRAPE_RUN_ID": "123-1", "SCRAPE_DROPLET_ID": "456"}
            command = ["bash", str(worker / "scripts/scrape.sh")]
            before = git(worker, "rev-parse", "HEAD")
            result = subprocess.run(command, env={**env, "FAIL_SCRAPE": "1"}, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((worker / "data/scrape-completed.json").exists())
            self.assertEqual(git(worker, "rev-parse", "HEAD"), before)
            subprocess.run(command, env={**env, "NEW_DATA": "1"}, check=True, capture_output=True)
            self.assertEqual(len(raw.read_text().splitlines()), 2)
            self.assertEqual((worker / "README").read_text(), "independent")
            self.assertEqual(git(worker, "log", "-1", "--format=%s"), "Scrape completed")
            self.assertEqual(git(worker, "rev-parse", "HEAD"), git(worker, "rev-parse", "origin/main"))
            subprocess.run(command, env={**env, "SCRAPE_RUN_ID": "124-1"}, check=True, capture_output=True)
            marker = json.loads((worker / "data/scrape-completed.json").read_text())
            self.assertEqual(marker["run_id"], "124-1")
            self.assertEqual(marker["droplet_id"], 456)
            self.assertEqual(len(raw.read_text().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()

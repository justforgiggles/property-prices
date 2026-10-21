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


class CheckpointTests(unittest.TestCase):
    def test_publish_preserves_remote_changes_and_final_without_new_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "remote.git"
            worker = root / "worker"
            other = root / "other"
            def git(cwd, *args):
                return subprocess.check_output(["git", "-C", str(cwd), *args], text=True, stderr=subprocess.DEVNULL).strip()
            subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(remote)], check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["git", "clone", str(remote), str(worker)], check=True, stderr=subprocess.DEVNULL)
            git(worker, "config", "user.name", "Test")
            git(worker, "config", "user.email", "test@example.com")
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
            raw = worker / "data/raw"
            raw.mkdir(parents=True)
            (raw / "2026-10-21.jsonl").write_text('{"id":123,"jsonld":[]}\n')
            command = ["python3", str(ROOT / "scripts/scrape-checkpoint.py")]
            subprocess.run([*command, "checkpoint"], cwd=worker, check=True, stdout=subprocess.DEVNULL)
            self.assertIn("[skip ci]", git(worker, "log", "-1", "--format=%s"))
            self.assertEqual((worker / "README").read_text(), "independent")
            env = {**os.environ, "SCRAPE_RUN_ID": "123-1", "SCRAPE_DROPLET_ID": "456"}
            subprocess.run([*command, "complete"], cwd=worker, env=env, check=True, stdout=subprocess.DEVNULL)
            self.assertNotIn("[skip ci]", git(worker, "log", "-1", "--format=%s"))
            self.assertEqual(json.loads((worker / "data/scrape-completed.json").read_text())["droplet_id"], 456)
            (raw / "2026-10-21.jsonl").write_text('{"id":123')
            result = subprocess.run([*command, "checkpoint"], cwd=worker, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(git(worker, "rev-parse", "HEAD"), git(worker, "rev-parse", "origin/main"))


if __name__ == "__main__":
    unittest.main()

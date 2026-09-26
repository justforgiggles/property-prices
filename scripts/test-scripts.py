"""Exercise shell entrypoints with stubbed tools; never deploy or send email."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ScriptTests(unittest.TestCase):
    def test_training_arguments_and_deployment_order(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / "packages/model/.venv/bin").mkdir(parents=True)
            (root / "tools").mkdir()
            for name in ("train.sh", "deploy.sh"):
                shutil.copyfile(ROOT / "scripts" / name, root / "scripts" / name)
            stub = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
name = Path(sys.argv[0]).name
with open(os.environ["COMMAND_LOG"], "a") as stream:
    stream.write(json.dumps([name, *sys.argv[1:]]) + "\\n")
if os.environ.get("FAIL_VERIFY") and name == "python":
    sys.exit(1)
'''
            for path in (root / "tools/gcloud", root / "packages/model/.venv/bin/python"):
                path.write_text(stub)
                path.chmod(0o755)
            log = root / "commands.jsonl"
            env = {**os.environ, "PATH": str(root / "tools") + os.pathsep + os.environ["PATH"], "COMMAND_LOG": str(log)}
            subprocess.run(["sh", str(root / "scripts/train.sh"), "--output-dir", "relative output"], cwd="/tmp", env=env, check=True)
            import json
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            self.assertEqual(calls[0], ["python", "-m", "property_model", "train", "--output-dir", "relative output"])
            log.write_text("")
            subprocess.run(["sh", str(root / "scripts/deploy.sh")], cwd="/tmp", env=env, check=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            deployments = [call for call in calls if call[1:3] == ["run", "deploy"]]
            self.assertEqual([call[3] for call in deployments], ["property-prices-valuation"])
            self.assertIn("python314", deployments[0])
            self.assertIn("packages/model", deployments[0])
            self.assertIn("WORKERS=1,THREADS=1,RESEND_FROM_EMAIL=Peter <hello@frms.dev>", deployments[0])
            self.assertIn("RESEND_API_KEY=resend-api-key:latest", deployments[0])
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0][1:3], ["-m", "property_model.artifacts"])
            log.write_text("")
            result = subprocess.run(["sh", str(root / "scripts/deploy.sh")], env={**env, "FAIL_VERIFY": "1"})
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('"deploy", "property-prices-valuation"', log.read_text())


if __name__ == "__main__":
    unittest.main()

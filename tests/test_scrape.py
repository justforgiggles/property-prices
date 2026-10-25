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


if __name__ == "__main__":
    unittest.main()

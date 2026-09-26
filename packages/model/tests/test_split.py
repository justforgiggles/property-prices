import json
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from property_model.train import reserve_test


class SplitTests(unittest.TestCase):
    def test_freezes_groups_and_rejects_changed_data(self):
        data = pd.DataFrame({"id": [str(i) for i in range(40)], "group": [i // 2 for i in range(40)]})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "split.json"
            development, test = reserve_test(data, {"raw_sha256": "original"}, path)
            self.assertFalse(set(development.group) & set(test.group))
            self.assertEqual(len(development) + len(test), len(data))
            before = path.read_bytes()
            reserve_test(data, {"raw_sha256": "original"}, path)
            self.assertEqual(before, path.read_bytes())
            with self.assertRaisesRegex(ValueError, "Raw data changed"):
                reserve_test(data, {"raw_sha256": "changed"}, path)
            membership = json.loads(before)
            membership["test"].append(membership["development"][0])
            path.write_text(json.dumps(membership))
            with self.assertRaisesRegex(ValueError, "overlap"):
                reserve_test(data, {"raw_sha256": "original"}, path)

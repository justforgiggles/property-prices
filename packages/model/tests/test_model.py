import json
from pathlib import Path
import tempfile
import unittest

from property_model import evaluation
from property_model.data import load_data, normalize_raw
from property_model.train import promote


def raw(index: int) -> dict:
    return {
        "id": index,
        "jsonld": [{"@graph": [{
            "about": {
                "address": {
                    "addressCountry": "South Africa",
                    "addressLocality": "Sea Point",
                    "addressRegion": "Western Cape",
                },
                "description": "House",
                "floorSize": {"value": 120},
                "numberOfBathroomsTotal": 2,
                "numberOfBedrooms": 3,
            },
            "breadcrumb": {"itemListElement": [{}, {}, {"name": "Cape Town"}]},
            "datePosted": "2026-09-01",
            "offers": {"priceSpecification": {"price": "3,500,000", "priceCurrency": "ZAR"}},
        }]}],
    }


class ModelTests(unittest.TestCase):
    def test_reads_daily_raw_files_and_actual_bathrooms(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2026-09-01.jsonl"
            path.write_text("".join(json.dumps(raw(index)) + "\n" for index in range(20)), encoding="utf-8")
            data = load_data(Path(directory))
            self.assertEqual(len(data), 20)
            self.assertEqual(data.iloc[0]["bathrooms"], 2)
            self.assertEqual(data.iloc[0]["bedrooms"], 3)
            self.assertEqual(data.iloc[0]["price"], 3_500_000)

    def test_rejects_duplicate_ids_and_skips_incomplete_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2026-09-01.jsonl"
            records = [raw(index) for index in range(20)]
            records[1]["jsonld"][0]["@graph"][0]["about"]["floorSize"] = {}
            path.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
            self.assertIsNone(normalize_raw(records[1]))
            self.assertEqual(len(load_data(Path(directory), minimum_rows=19)), 19)
            path.write_text(json.dumps(raw(1)) + "\n" + json.dumps(raw(1)) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate raw listing ID"):
                load_data(Path(directory), minimum_rows=1)

    def test_quality_gate_failure_and_bundle_promotion(self):
        report = {"cv": {"mdape": 26.0, "r2_log": 0.69}, "interval_coverage_pct": 90.0}
        quality = {"max_mdape": 25.0, "min_r2_log": 0.7, "min_interval_coverage": 75.0, "max_interval_coverage": 85.0}
        self.assertEqual(len(evaluation.quality_failures(report, quality)), 3)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / "models"
            stage = root / "stage"
            destination.mkdir()
            stage.mkdir()
            (destination / "old").write_text("old", encoding="utf-8")
            (stage / "new").write_text("new", encoding="utf-8")
            promote(stage, destination)
            self.assertEqual([path.name for path in destination.iterdir()], ["new"])

    def test_restores_previous_bundle_after_interrupted_promotion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / "models"
            backup = root / ".models-backup"
            backup.mkdir()
            (backup / "old").write_text("old", encoding="utf-8")
            with self.assertRaises(FileNotFoundError):
                promote(root / "missing-stage", destination)
            self.assertEqual((destination / "old").read_text(encoding="utf-8"), "old")


if __name__ == "__main__":
    unittest.main()

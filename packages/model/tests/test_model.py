import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import pandas as pd

from property_model import evaluation, features, modeling
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

    def test_keeps_missing_size_and_rejects_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2026-09-01.jsonl"
            records = [raw(index) for index in range(20)]
            records[1]["jsonld"][0]["@graph"][0]["about"]["floorSize"] = {}
            path.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")
            self.assertIsNone(normalize_raw(records[1])["size"])
            data, report = load_data(Path(directory), return_report=True)
            self.assertEqual(len(data), 20)
            self.assertEqual(report["included"], 20)
            invalid_price = raw(21)
            invalid_price["jsonld"][0]["@graph"][0]["offers"]["priceSpecification"]["price"] = 575
            self.assertIsNone(normalize_raw(invalid_price))
            missing_bedroom = raw(22)
            del missing_bedroom["jsonld"][0]["@graph"][0]["about"]["numberOfBedrooms"]
            self.assertIsNone(normalize_raw(missing_bedroom)["bedrooms"])
            path.write_text(json.dumps(raw(1)) + "\n" + json.dumps(raw(1)) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Duplicate raw listing ID"):
                load_data(Path(directory), minimum_rows=1)

    def test_rejects_filename_date_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2026-09-02.jsonl"
            path.write_text(json.dumps(raw(1)) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "does not match"):
                load_data(Path(directory), minimum_rows=1)

    def test_composite_geography_and_missing_size_imputation(self):
        rows = []
        for index, (region, city, size, price) in enumerate([
            ("Western Cape", "Cape Town", 100, 5_000_000),
            ("Gauteng", "Johannesburg", 200, 1_000_000),
            ("Western Cape", "Cape Town", np.nan, 4_000_000),
        ]):
            rows.append({
                "id": index,
                "date_posted": f"2026-09-0{index + 1}",
                "country": "South Africa",
                "region": region,
                "locality_1": city,
                "locality_2": "Newlands",
                "type": "House",
                "bedrooms": 3,
                "bathrooms": 2,
                "size": size,
                "price": price,
            })
        data = pd.DataFrame(rows)
        encoders = features.fit_encoders(data)
        self.assertIn("Western Cape|Cape Town|Newlands", encoders.target_encoding["locality_2"])
        self.assertIn("Gauteng|Johannesburg|Newlands", encoders.target_encoding["locality_2"])
        self.assertEqual(encoders.loc2_count["Western Cape|Cape Town|Newlands"], 2)
        values = features.record_to_features(rows[-1], encoders)
        self.assertEqual(values[features.FEATURE_ORDER.index("size")], 100)
        self.assertEqual(values[features.FEATURE_ORDER.index("size_missing")], 1)

    def test_temporal_folds_never_train_on_validation_or_future_dates(self):
        data = pd.DataFrame({
            "date_posted": np.repeat(pd.date_range("2026-01-01", periods=12).astype(str), 10),
            "size": 100.0,
            "bedrooms": 3,
            "bathrooms": 2,
        })
        for train, validation in modeling._temporal_folds(data, 3):
            self.assertLess(data.iloc[train].date_posted.max(), data.iloc[validation].date_posted.min())

    def test_conformal_widening_never_contracts_or_returns_negative_price(self):
        widening = modeling.conformal_widen(np.array([2.0]), np.array([4.0]), np.array([3.0]))
        self.assertEqual(widening, 0)
        low, high = modeling.apply_interval(np.array([-2.0]), np.array([1.0]), widening)
        self.assertEqual(low[0], 0)
        self.assertGreater(high[0], 0)

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

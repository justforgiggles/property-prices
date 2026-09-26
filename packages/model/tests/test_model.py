"""Run with .venv/bin/python -m unittest discover -s src/tests -v."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from property_model.artifacts import load_model, save_model, sha256
from property_model.comparables import comparable_features
from property_model.config import CATBOOST_PARAMS, EXAMPLE, FEATURE_COLUMNS, LIGHTGBM_PARAMS
from property_model.data import clean_listings, inputs_frame, extract_listing
from property_model.evaluation import metrics
from property_model.features import build_reference, prediction_features, structural_features, training_features
from property_model.modeling import fit_model


def listings(count=40):
    records = [dict(province="P", city="C", suburb="S", bedrooms=2 + index % 3,
                    bathrooms=1 + index % 2, floor_size=50 + 5 * index, rates=500 + 10 * index)
               for index in range(count)]
    frame = inputs_frame(records)
    frame["price"] = 500000 + np.arange(count) * 35000
    frame["group"] = np.arange(count) // 2
    return frame


class PipelineTests(unittest.TestCase):
    def test_input_boundaries_and_structural_features(self):
        for bad in [{"rates": -1}, {"floor_size": True}, {"bedrooms": float("inf")},
                    {"bedrooms": "2"}, {"price": 100}, {"city": 123}, [], [None]]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                inputs_frame(bad)
        frame = inputs_frame([dict(province=" KwaZulu-Natal ", floor_size=50, bedrooms=0),
                              dict(floor_size=100), {}])
        features = structural_features(frame)
        self.assertEqual(frame.province.iloc[0], "kwazulu natal")
        self.assertEqual(features.size_band.iloc[:2].tolist(), ["(0.0, 50.0]", "(50.0, 100.0]"])
        self.assertTrue(pd.isna(features.floor_size_per_bedrooms.iloc[0]))
        self.assertEqual(features.floor_size_missing.iloc[2], 1)

    def test_source_precedence_cleaning_and_linkage(self):
        nested = dict(id=1, price=1, bedrooms=9, jsonld=[{"@graph": [dict(
            offers={"priceSpecification": {"price": "1200000"}},
            breadcrumb={"itemListElement": [{"position": 2, "name": "P"}, {"position": 3, "name": "C"}, {"position": 4, "name": "S"}]},
            about={"@type": "House", "description": "House", "numberOfBedrooms": None, "address": {}},
            description="For sale", image="shared-image", datePosted="2026-01-01")]}])
        row = extract_listing(nested, "2026-01-01")
        self.assertEqual(row["price"], "1200000")
        self.assertIsNone(row["bedrooms"])
        rows = [dict(row, id=str(index), floor_size=0, rates=None) for index in range(5)]
        rows[2]["price"] = "POA"
        rows[3]["description"] = "House to rent"
        rows[4].update(kind="Place", property_type="Vacant land")
        cleaned, audit = clean_listings(pd.DataFrame(rows))
        self.assertEqual(len(cleaned), 2)
        self.assertEqual(cleaned.group.nunique(), 1)
        self.assertTrue(cleaned.floor_size.isna().all())
        self.assertEqual(audit["excluded_rows"], 3)

    def test_group_cross_fit_and_query_target_isolation(self):
        frame = listings()
        original = training_features(frame)
        changed = frame.copy()
        changed.loc[changed.group == 0, "price"] *= 1000
        rebuilt = training_features(changed)
        pd.testing.assert_frame_equal(original.iloc[:2], rebuilt.iloc[:2])
        reference = build_reference(frame.iloc[10:])
        pd.testing.assert_frame_equal(prediction_features(frame.iloc[:2], reference),
                                      prediction_features(changed.iloc[:2], reference))
        self.assertEqual(original.columns.tolist(), FEATURE_COLUMNS)

    def test_comparable_median_distance_and_sparse_fallback(self):
        frame = inputs_frame([dict(province="P", city="C", suburb="S", bedrooms=2,
                                   bathrooms=1, floor_size=100, rates=800) for _ in range(5)])
        frame["price"] = [1000000, 1100000, 1150000, 1375000, 1300000]
        frame.loc[3, "floor_size"] = 121
        frame.loc[4, "bedrooms"] = 3
        result = comparable_features(frame.iloc[:1], build_reference(frame)).iloc[0]
        self.assertAlmostEqual(np.exp(result.comp_log), 1150000)
        self.assertEqual(result.comp_fallback, 0)
        # Four local records force a city pool containing the fifth listing.
        frame.loc[4, "suburb"] = "other"
        frame.loc[4, "suburb_key"] = "p|c|other"
        reference = build_reference(frame)
        self.assertEqual(comparable_features(frame.iloc[:1], reference).comp_fallback.iloc[0], 1)
        empty = comparable_features(inputs_frame({}), reference, safe_empty=True).iloc[0]
        self.assertEqual(empty.comp_count, 0)
        self.assertEqual(empty.comp_fallback, 3)
        self.assertEqual(empty.comp_log, reference["global_log_price"])
        self.assertAlmostEqual(metrics([100, 100, 100], [80, 120, 121])["within_20_pct"], 200 / 3)

    def test_native_roundtrip_and_failed_save_preserves_model(self):
        # Tiny iterations exercise the same eleven-learner path without a full retrain.
        with patch.dict(LIGHTGBM_PARAMS, n_estimators=3, num_leaves=7, min_child_samples=2), patch.dict(CATBOOST_PARAMS, iterations=3, depth=3):
            model = fit_model(listings())
            records = [EXAMPLE, {}, {"province": "unknown", "bedrooms": 2}]
            before = model.predict(records)
            with tempfile.TemporaryDirectory() as folder:
                directory = Path(folder) / "model"
                save_model(model, directory, {"population": "test"})
                restored = load_model(directory)
                after = restored.predict(records)
                np.testing.assert_allclose([r["unrounded_prediction_zar"] for r in before],
                                           [r["unrounded_prediction_zar"] for r in after], rtol=1e-12)
                self.assertEqual(after[1]["comparable_count"], 0)
                self.assertIsNone(after[1]["model_log_std"])
                digest = sha256(directory / "manifest.json")
                with patch.object(model.residual, "save_model", side_effect=OSError("simulated write failure")):
                    with self.assertRaises(OSError):
                        save_model(model, directory, {})
                self.assertEqual(digest, sha256(directory / "manifest.json"))
                load_model(directory)
                # Also recover if publication fails after the old package was moved aside.
                rename = Path.rename

                def interrupted_publish(source, target):
                    if Path(target).resolve() == directory.resolve() and "previous" not in source.name:
                        raise OSError("simulated publication failure")
                    return rename(source, target)

                with patch.object(Path, "rename", interrupted_publish):
                    with self.assertRaises(OSError):
                        save_model(model, directory, {})
                self.assertEqual(digest, sha256(directory / "manifest.json"))
                load_model(directory)
                (directory / "catboost.cbm").write_bytes(b"corrupted")
                with self.assertRaisesRegex(ValueError, "integrity"):
                    load_model(directory)


if __name__ == "__main__":
    unittest.main()

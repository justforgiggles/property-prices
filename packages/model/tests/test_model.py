import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from property_model import evaluation, features, hypertune, modeling
from property_model.data import load_data, normalize_raw
from property_model.locations import build_locations, render_location_fields
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
    def test_location_catalog_is_sorted_and_disambiguates_duplicate_cities(self):
        data = pd.DataFrame([
            {
                "region": "Western Cape",
                "locality_1": "Heidelberg",
                "locality_2": "Heidelberg",
            },
            {
                "region": "Gauteng",
                "locality_1": "Heidelberg",
                "locality_2": "Rensburg",
            },
            {
                "region": "Gauteng",
                "locality_1": "Alberton",
                "locality_2": "Brackenhurst",
            },
        ])
        locations = build_locations(data)
        self.assertEqual(list(locations), ["Gauteng", "Western Cape"])
        self.assertEqual(list(locations["Gauteng"]), ["Alberton", "Heidelberg"])
        rendered = render_location_fields(locations)
        self.assertIn('label: "Rensburg (Gauteng)"', rendered)
        self.assertIn('label: "Heidelberg (Western Cape)"', rendered)

    def test_reads_daily_raw_files_and_actual_bathrooms(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2026-09-01.jsonl"
            path.write_text("".join(json.dumps(raw(index)) + "\n" for index in range(20)), encoding="utf-8")
            data = load_data(Path(directory))
            self.assertEqual(len(data), 20)
            self.assertEqual(data.iloc[0]["bathrooms"], 2)
            self.assertEqual(data.iloc[0]["bedrooms"], 3)
            self.assertEqual(data.iloc[0]["price"], 3_500_000)

    def test_normalizes_rates_and_taxes_without_dropping_rows(self):
        for index, (value, expected) in enumerate((
            (1_250.50, 1_250.50),
            (None, None),
            (0, None),
            (100_001, None),
            ("unknown", None),
        )):
            record = raw(index)
            record["ratesAndTaxes"] = value
            normalized = normalize_raw(record)
            self.assertIsNotNone(normalized)
            if expected is None:
                self.assertIsNone(normalized["rates_and_taxes"])
            else:
                self.assertEqual(normalized["rates_and_taxes"], expected)

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

    def test_preserves_half_rooms_and_nulls_unusable_rooms(self):
        for index, value in enumerate((0.5, 1.5, 2.5)):
            record = raw(index)
            about = record["jsonld"][0]["@graph"][0]["about"]
            about["numberOfBedrooms"] = value
            about["numberOfBathroomsTotal"] = value
            normalized = normalize_raw(record)
            self.assertEqual(normalized["bedrooms"], value)
            self.assertEqual(normalized["bathrooms"], value)

        for field in ("numberOfBedrooms", "numberOfBathroomsTotal"):
            for value in (0, 21, 1.2):
                record = raw(10)
                record["jsonld"][0]["@graph"][0]["about"][field] = value
                normalized = normalize_raw(record)
                self.assertIsNotNone(normalized)
                key = "bedrooms" if field == "numberOfBedrooms" else "bathrooms"
                self.assertIsNone(normalized[key])

    def test_nulls_unusable_size_without_dropping_market_row(self):
        cases = (
            (None, 3_500_000),
            ({"value": "large"}, 3_500_000),
            ({"value": 5_001}, 3_500_000),
            ({"value": 5_000}, 1_000_000),
        )
        for index, (floor_size, price) in enumerate(cases):
            record = raw(index)
            node = record["jsonld"][0]["@graph"][0]
            node["about"]["floorSize"] = floor_size
            node["offers"]["priceSpecification"]["price"] = price
            normalized = normalize_raw(record)
            self.assertIsNotNone(normalized)
            self.assertIsNone(normalized["size"])

    def test_hard_exclusions_and_cohort_conservation(self):
        exclusions = []
        for index, (field, value) in enumerate((
            ("addressCountry", "Namibia"),
            ("addressRegion", "Free State"),
        )):
            record = raw(index)
            record["jsonld"][0]["@graph"][0]["about"]["address"][field] = value
            exclusions.append(record)
        unsupported_type = raw(2)
        unsupported_type["jsonld"][0]["@graph"][0]["about"]["description"] = "Vacant Land / Plot"
        exclusions.append(unsupported_type)
        non_zar = raw(3)
        non_zar["jsonld"][0]["@graph"][0]["offers"]["priceSpecification"]["priceCurrency"] = "USD"
        exclusions.append(non_zar)
        invalid_price = raw(4)
        invalid_price["jsonld"][0]["@graph"][0]["offers"]["priceSpecification"]["price"] = 23_000
        exclusions.append(invalid_price)
        rental = raw(5)
        rental["jsonld"][0]["@graph"][0]["breadcrumb"]["itemListElement"][0]["name"] = "Property to Rent"
        exclusions.append(rental)
        for record in exclusions:
            self.assertIsNone(normalize_raw(record))

        complete = raw(10)
        no_size = raw(11)
        no_size["jsonld"][0]["@graph"][0]["about"]["floorSize"] = None
        no_rooms = raw(12)
        no_rooms["jsonld"][0]["@graph"][0]["about"]["numberOfBedrooms"] = 0
        hard_excluded = raw(13)
        hard_excluded["jsonld"][0]["@graph"][0]["offers"]["priceSpecification"]["price"] = 23_000
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2026-09-01.jsonl"
            path.write_text(
                "".join(json.dumps(record) + "\n" for record in (complete, no_size, no_rooms, hard_excluded)),
                encoding="utf-8",
            )
            _, report = load_data(Path(directory), minimum_rows=1, return_report=True)
        self.assertEqual(report["cohorts"], {"market": 3, "rooms": 2, "size": 1})
        self.assertEqual(report["included_missing_rates_and_taxes"], 3)
        self.assertEqual(report["conservation"], {
            "hard_excluded": 1,
            "market_only": 1,
            "rooms_only": 1,
            "size": 1,
            "total": 4,
        })
        self.assertEqual(report["total"], report["conservation"]["total"])

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
        self.assertEqual(values[features.FEATURE_ORDER.index("log_rates_and_taxes")], 0)
        self.assertEqual(values[features.FEATURE_ORDER.index("rates_and_taxes_missing")], 1)
        present = features.record_to_features(
            {**rows[-1], "rates_and_taxes": 1_800}, encoders
        )
        self.assertAlmostEqual(
            present[features.FEATURE_ORDER.index("log_rates_and_taxes")],
            np.log1p(1_800),
        )
        self.assertEqual(
            present[features.FEATURE_ORDER.index("rates_and_taxes_missing")], 0
        )

    def test_temporal_folds_never_train_on_validation_or_future_dates(self):
        data = pd.DataFrame({
            "date_posted": np.repeat(pd.date_range("2026-01-01", periods=12).astype(str), 10),
            "size": 100.0,
            "bedrooms": 3,
            "bathrooms": 2,
            "rates_and_taxes": np.tile([1_000.0, np.nan], 60),
        })
        for train, validation in modeling._temporal_folds(data, 3):
            self.assertLess(data.iloc[train].date_posted.max(), data.iloc[validation].date_posted.min())
            self.assertTrue(data.iloc[validation].rates_and_taxes.notna().all())

    def test_training_weights_keep_missing_rates_rows_at_ten_percent(self):
        matrix = np.zeros((2, len(features.FEATURE_ORDER)))
        matrix[1, features.FEATURE_ORDER.index("rates_and_taxes_missing")] = 1
        np.testing.assert_array_equal(
            modeling.training_weights(matrix, {"missing_rates_weight": 0.1}),
            [1.0, 0.1],
        )

    def test_tuning_selection_skips_calibration_and_test_folds(self):
        data = pd.DataFrame({
            "date_posted": np.repeat(pd.date_range("2026-01-01", periods=12).astype(str), 10),
            "size": 100.0,
            "bedrooms": 3,
            "bathrooms": 2,
            "rates_and_taxes": 1_000.0,
            "price": 1_000_000.0,
        })
        folds = modeling._temporal_folds(data, 5)
        cache = {(number, 10.0, 10.0, 42, 5, False): (
            np.zeros((20, len(features.FEATURE_ORDER))),
            np.zeros(20),
            np.zeros((len(validation), len(features.FEATURE_ORDER))),
        ) for number, (_, validation) in enumerate(folds[:-2])}
        class ConstantModel:
            def predict(self, values):
                return np.zeros(len(values))
        with patch.object(modeling, "fit_point", return_value=ConstantModel()) as fit:
            result = modeling.temporal_cv_predict(
                data, {
                    "missing_rates_weight": 0.1,
                    "smoothing": 10,
                    "ppsqm_smoothing": 10,
                },
                n_splits=5, inner_splits=5, seed=42,
                train_missing_size=False, selection_only=True, matrix_cache=cache,
            )
        self.assertEqual(fit.call_count, len(folds) - 2)
        self.assertLess(result["index"].max(), folds[-2][1].min())

    def test_tuner_is_deterministic_and_restores_config_on_failure(self):
        base = {"min_data_in_leaf": 1, "ensemble": [{"weight": 0.5}, {"weight": 0.5}]}
        self.assertEqual(list(hypertune.candidates(base, 2)), list(hypertune.candidates(base, 2)))
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory)
            (package / "config").mkdir()
            config = package / "config" / "model.json"
            config.write_text('{"seed":42}\n', encoding="utf-8")
            with patch.object(hypertune, "train", side_effect=RuntimeError("export failed")):
                with self.assertRaisesRegex(RuntimeError, "export failed"):
                    hypertune.promote_candidate(package, {"seed": 137})
            self.assertEqual(config.read_text(encoding="utf-8"), '{"seed":42}\n')

    def test_tuner_leaves_non_improving_model_intact(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory) / "packages" / "model"
            (package / "config").mkdir(parents=True)
            config = package / "config" / "model.json"
            config.write_text(json.dumps({"seed": 42, "cv_splits": 5, "model": {}}), encoding="utf-8")
            with patch.object(hypertune, "load_data"), patch.object(
                hypertune.evaluation, "evaluate_point", return_value={"rmsle": 0.3}
            ), patch.object(hypertune, "promote_candidate") as promote:
                summary = hypertune.tune(package, trials=1)
            self.assertEqual(summary["status"], "not_improved")
            self.assertEqual(json.loads(config.read_text(encoding="utf-8"))["seed"], 42)
            promote.assert_not_called()

    def test_inner_oof_ignores_dates_and_ppsqm_is_unweighted(self):
        rows = pd.DataFrame([
            {
                "id": index,
                "date_posted": f"2026-01-{index + 1:02d}",
                "country": "South Africa",
                "region": "Gauteng",
                "locality_1": "Johannesburg",
                "locality_2": f"Suburb {index % 3}",
                "type": "House",
                "bedrooms": 3,
                "bathrooms": 2,
                "size": 100,
                "price": 1_000_000 + index * 100_000,
            }
            for index in range(10)
        ])
        dated = features.build_oof_matrix(rows, n_splits=2, seed=7)
        undated = features.build_oof_matrix(
            rows.drop(columns="date_posted"), n_splits=2, seed=7
        )
        np.testing.assert_array_equal(dated, undated)
        encoders = features.fit_encoders(rows)
        expected = np.log(rows["price"] / rows["size"]).mean()
        self.assertAlmostEqual(encoders.global_ppsqm, expected)
        self.assertNotIn("ppsqm_half_life_days", encoders.metadata)

    def test_conformal_widening_never_contracts_or_returns_negative_price(self):
        widening = modeling.conformal_widen(np.array([2.0]), np.array([4.0]), np.array([3.0]))
        self.assertEqual(widening, 0)
        low, high = modeling.apply_interval(np.array([-2.0]), np.array([1.0]), widening)
        self.assertEqual(low[0], 0)
        self.assertGreater(high[0], 0)

    def test_ensemble_weights_are_normalized(self):
        params = {
            "iterations": 5,
            "ensemble": [
                {"weight": 2},
                {"weight": 1, "overrides": {"depth": 8}},
            ],
        }
        members = modeling._members(params)
        self.assertEqual([weight for _, weight in members], [2 / 3, 1 / 3])
        self.assertNotIn("ensemble", members[0][0])
        self.assertEqual(members[1][0]["depth"], 8)

    def test_confidence_features_and_low_risk_precedence(self):
        matrix = np.zeros((2, len(features.FEATURE_ORDER)), dtype=np.float32)
        confidence = modeling.confidence_matrix(
            matrix,
            np.array([1_000_000.0, 2_000_000.0]),
            np.array([13.0, 14.0]),
            np.array([13.2, 14.4]),
        )
        self.assertEqual(confidence.shape, (2, len(modeling.CONFIDENCE_FEATURE_ORDER)))
        np.testing.assert_array_equal(
            evaluation.confidence_tiers(
                np.array([0.6, 0.1]), np.array([0.1, 0.2]), 0.3
            ),
            ["low", "high"],
        )

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

    def test_balanced_accuracy_and_interval_width_gates(self):
        report = {
            "test": {
                "mdape": 18.0,
                "r2_log": 0.82,
                "rmsle": 0.37,
                "within_20": 51.0,
                "median_bias": 0.0,
            },
            "interval_coverage_pct": 80.0,
            "interval_median_relative_width_pct": 85.0,
        }
        quality = {
            "max_mdape": 19.0,
            "min_r2_log": 0.8,
            "max_rmsle": 0.36,
            "min_within_20": 52.0,
            "max_abs_median_bias": 5.0,
            "min_interval_coverage": 75.0,
            "max_interval_coverage": 85.0,
            "max_interval_width": 84.0,
        }
        self.assertEqual(len(evaluation.quality_failures(report, quality)), 3)

    def test_confidence_quality_gates(self):
        report = {
            "cv": {"mdape": 18.0, "r2_log": 0.82},
            "interval_coverage_pct": 80.0,
            "confidence": {"test": {
                "high": {"n": 49, "within_20": 79.0},
                "medium": {"n": 100, "within_20": 60.0},
                "low": {"n": 99, "within_20": 51.0},
            }},
        }
        quality = {
            "max_mdape": 19.0,
            "min_r2_log": 0.8,
            "min_interval_coverage": 75.0,
            "max_interval_coverage": 85.0,
            "min_precise_rows": 50,
            "min_precise_within_20": 80.0,
            "min_low_confidence_rows": 100,
            "max_low_confidence_within_20": 50.0,
        }
        self.assertEqual(len(evaluation.quality_failures(report, quality)), 4)

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

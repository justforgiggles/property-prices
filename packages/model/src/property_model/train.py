"""Evaluate, export, verify, and promote one ONNX deployment bundle."""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import numpy as np

from . import evaluation, features, modeling
from .data import load_data

DEPLOYMENT_FILES = {
    "encoders.json",
    "model.onnx",
    "model_confidence.onnx",
    "model_q10.onnx",
    "model_q90.onnx",
}
ONNX_PARAMETERS = {
    "onnx_domain": "ai.catboost",
    "onnx_model_version": 1,
    "onnx_doc_string": "CatBoost property valuation (predicts log1p price)",
    "onnx_graph_name": "PropertyPriceRegressor",
}


def promote(stage: Path, destination: Path) -> None:
    backup = destination.with_name(f".{destination.name}-backup")
    if backup.exists():
        if destination.exists():
            shutil.rmtree(backup)
        else:
            os.replace(backup, destination)
    if destination.exists():
        os.replace(destination, backup)
    try:
        os.replace(stage, destination)
    except Exception:
        if backup.exists():
            os.replace(backup, destination)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def _python_prediction(models: dict, encoders: features.Encoders, record: dict) -> dict:
    matrix = np.asarray([features.record_to_features(record, encoders)], dtype=np.float32)
    low_log = float(models["model_q10"].predict(matrix)[0])
    high_log = float(models["model_q90"].predict(matrix)[0])
    point_log = float(models["model"].predict(matrix)[0])
    low = max(0.0, float(np.expm1(min(low_log, high_log) - encoders.interval_log_widen)))
    high = float(np.expm1(max(low_log, high_log) + encoders.interval_log_widen))
    recommended = min(max(float(np.expm1(point_log)), low), high)
    confidence_matrix = modeling.confidence_matrix(
        matrix, np.asarray([np.expm1(point_log)]), np.asarray([low_log]), np.asarray([high_log])
    )
    risk = min(1.0, max(0.0, float(models["model_confidence"].predict(confidence_matrix)[0])))
    settings = encoders.confidence
    confidence = (
        "low"
        if risk >= settings["low_min_error_risk"]
        else "high"
        if abs(high_log - low_log) <= settings["precise_max_quantile_log_width"]
        else "medium"
    )
    return {
        "low": low,
        "recommended": None if confidence == "low" else recommended,
        "high": high,
        "confidence": confidence,
        "errorRisk": risk,
    }


def verify_bundle(package: Path, stage: Path, models: dict, encoders: features.Encoders) -> None:
    if {path.name for path in stage.iterdir()} != DEPLOYMENT_FILES:
        raise RuntimeError("Deployment bundle contains unexpected files")
    records_path = package / "tests" / "verification-records.json"
    result = subprocess.run(
        ["node", str(package / "tests" / "verify-onnx.cjs"), "--model-dir", str(stage), "--records", str(records_path), "--json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(f"Node ONNX verification failed: {result.stderr.strip()}")
    records = json.loads(records_path.read_text(encoding="utf-8"))
    predictions = json.loads(result.stdout)
    if len(predictions) != len(records):
        raise RuntimeError("ONNX verification returned the wrong number of predictions")
    for record, node_prediction in zip(records, predictions, strict=True):
        python_prediction = _python_prediction(models, encoders, record)
        for field in ("low", "high", "errorRisk"):
            if not math.isfinite(node_prediction[field]) or not math.isclose(python_prediction[field], node_prediction[field], rel_tol=1e-5, abs_tol=1e-5 if field == "errorRisk" else 1.0):
                raise RuntimeError(f"Python/Node ONNX prediction differs for {field}")
        if python_prediction["confidence"] != node_prediction["confidence"]:
            raise RuntimeError("Python/Node confidence tier differs")
        if python_prediction["recommended"] is None:
            if node_prediction["recommended"] is not None:
                raise RuntimeError("Low-confidence prediction exposed a point value")
        elif not math.isclose(python_prediction["recommended"], node_prediction["recommended"], rel_tol=1e-5, abs_tol=1.0):
            raise RuntimeError("Python/Node point prediction differs")
        if node_prediction["recommended"] is not None and not node_prediction["low"] <= node_prediction["recommended"] <= node_prediction["high"]:
            raise RuntimeError("ONNX prediction interval is not ordered")


def train(package: Path) -> None:
    repository = package.parent.parent
    config = json.loads((package / "config" / "model.json").read_text(encoding="utf-8"))
    data, data_report = load_data(
        repository / "data" / "raw",
        minimum_rows=max(20, int(config["cv_splits"]) * 2),
        return_report=True,
    )
    room_eligible = data[data[["bedrooms", "bathrooms"]].notna().all(axis=1)]
    complete = room_eligible[room_eligible[features.SIZE_COL].notna()].reset_index(drop=True)
    selected = "prior_only"
    training_data = complete
    encoder_data = data
    report, widening, predictions = evaluation.evaluate(
        encoder_data,
        config["model"],
        int(config["cv_splits"]),
        int(config["seed"]),
        train_missing_size=False,
        return_predictions=True,
    )
    confidence_model, confidence_report = evaluation.fit_confidence(
        predictions, int(config["seed"])
    )
    parameters = config["model"]
    selected_model = "catboost_ensemble"
    report = dict(report)
    report.update({
        "evaluation_cohort": "rates_and_taxes_present",
        "selected_data": selected,
        "selected_model": selected_model,
        "data_candidates": {selected: report["selection"]},
        "model_candidates": {selected_model: report["selection"]},
        "model_candidate_params": {selected_model: parameters},
        "data_quality": data_report,
        "confidence": confidence_report,
    })
    build = package / "build"
    build.mkdir(exist_ok=True)
    (build / "metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (build / "data-quality.json").write_text(json.dumps(data_report, indent=2) + "\n", encoding="utf-8")
    evaluation.print_report(report)
    failures = evaluation.quality_failures(report, config["quality"])
    if failures:
        raise RuntimeError("Model quality gate failed:\n" + "\n".join(failures))

    seed = int(config["seed"])
    encoders = features.fit_encoders(encoder_data, float(parameters["smoothing"]), float(parameters["ppsqm_smoothing"]))
    encoders.interval_log_widen = widening
    encoders.metadata.update({
        "model_version": 6,
        "evaluation_cohort": "rates_and_taxes_present",
        "selected_data": selected,
        "selected_model": selected_model,
        "source_cutoff": str(training_data["date_posted"].max()),
        "source_start": str(training_data["date_posted"].min()),
        "training_rows": len(training_data),
        "complete_rows": len(complete),
        "cohorts": data_report["cohorts"],
        "missing_size_rows": int(data[features.SIZE_COL].isna().sum()),
        "missing_rates_and_taxes_rows": int(data["rates_and_taxes"].isna().sum()),
        "rates_and_taxes_training_rows": int(training_data["rates_and_taxes"].notna().sum()),
        "missing_rates_weight": float(parameters["missing_rates_weight"]),
        "missing_room_rows": int(data[["bedrooms", "bathrooms"]].isna().any(axis=1).sum()),
        "config_sha256": hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest(),
        "data_sha256": hashlib.sha256(
            encoder_data[["id", "date_posted", "price", "size", "rates_and_taxes"]]
            .sort_values("id")
            .to_csv(index=False)
            .encode()
        ).hexdigest(),
        "test_metrics": report["test"],
        "confidence_test_metrics": report["confidence"]["test"],
    })
    encoders.confidence = {
        "feature_order": modeling.CONFIDENCE_FEATURE_ORDER,
        "precise_max_quantile_log_width": confidence_report[
            "precise_max_quantile_log_width"
        ],
        "low_min_error_risk": confidence_report["low_min_error_risk"],
    }
    matrix = features.build_oof_matrix(
        training_data,
        int(config["cv_splits"]),
        seed,
        float(parameters["smoothing"]),
        float(parameters["ppsqm_smoothing"]),
        prior_df=encoder_data,
    )
    target = np.log1p(training_data["price"].to_numpy(dtype=float))
    sample_weight = modeling.training_weights(matrix, parameters)
    point = modeling.fit_point(matrix, target, parameters, seed, sample_weight)
    low, high = modeling.fit_quantiles(
        matrix, target, parameters, seed, sample_weight
    )
    models = {
        "model": point,
        "model_q10": low,
        "model_q90": high,
        "model_confidence": confidence_model,
    }

    with tempfile.TemporaryDirectory(dir=build) as directory:
        stage = Path(directory) / "models"
        stage.mkdir()
        for name, model in models.items():
            model.save_model(stage / f"{name}.onnx", format="onnx", export_parameters=ONNX_PARAMETERS)
        features.save_encoders(encoders, stage / "encoders.json")
        verify_bundle(package, stage, models, encoders)
        promote(stage, package / "models")
    print(f"Verified deployment bundle from {len(training_data)} {selected} listings")

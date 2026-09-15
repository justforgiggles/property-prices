"""Evaluate, export, verify, and promote one ONNX deployment bundle."""

from __future__ import annotations

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

DEPLOYMENT_FILES = {"encoders.json", "model.onnx", "model_q10.onnx", "model_q90.onnx"}
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
    low = float(np.expm1(min(low_log, high_log) - encoders.interval_log_widen))
    high = float(np.expm1(max(low_log, high_log) + encoders.interval_log_widen))
    recommended = float(np.expm1(models["model"].predict(matrix)[0]))
    return {"low": low, "recommended": min(max(recommended, low), high), "high": high}


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
        for field in ("low", "recommended", "high"):
            if not math.isfinite(node_prediction[field]) or not math.isclose(python_prediction[field], node_prediction[field], rel_tol=1e-5, abs_tol=1.0):
                raise RuntimeError(f"Python/Node ONNX prediction differs for {field}")
        if not node_prediction["low"] <= node_prediction["recommended"] <= node_prediction["high"]:
            raise RuntimeError("ONNX prediction interval is not ordered")


def train(package: Path) -> None:
    repository = package.parent.parent
    config = json.loads((package / "config" / "model.json").read_text(encoding="utf-8"))
    data = load_data(repository / "data" / "raw", minimum_rows=max(20, int(config["cv_splits"]) * 2))
    report, widening = evaluation.evaluate(data, config["model"], int(config["cv_splits"]), int(config["seed"]))
    build = package / "build"
    build.mkdir(exist_ok=True)
    (build / "metrics.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    evaluation.print_report(report)
    failures = evaluation.quality_failures(report, config["quality"])
    if failures:
        raise RuntimeError("Model quality gate failed:\n" + "\n".join(failures))

    parameters = config["model"]
    seed = int(config["seed"])
    encoders = features.fit_encoders(data, float(parameters["smoothing"]), float(parameters["ppsqm_smoothing"]))
    encoders.interval_log_widen = widening
    matrix = features.build_oof_matrix(data, int(config["cv_splits"]), seed, float(parameters["smoothing"]), float(parameters["ppsqm_smoothing"]))
    target = np.log1p(data["price"].to_numpy(dtype=float))
    point = modeling.fit_point(matrix, target, parameters, seed)
    low, high = modeling.fit_quantiles(matrix, target, parameters, seed)
    models = {"model": point, "model_q10": low, "model_q90": high}

    with tempfile.TemporaryDirectory(dir=build) as directory:
        stage = Path(directory) / "models"
        stage.mkdir()
        for name, model in models.items():
            model.save_model(stage / f"{name}.onnx", format="onnx", export_parameters=ONNX_PARAMETERS)
        features.save_encoders(encoders, stage / "encoders.json")
        verify_bundle(package, stage, models, encoders)
        promote(stage, package / "models")
    print(f"Verified deployment bundle from {len(data)} complete raw listings")

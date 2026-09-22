"""Search deployable CatBoost settings without using calibration or test rows for selection."""

from __future__ import annotations

import json
import os
from pathlib import Path
import random

from . import evaluation
from .data import load_data
from .train import train

SEEDS = (42, 137, 2026, 7, 73)


def candidates(base: dict, count: int):
    """Sample the settings that affect the current symmetric-tree ensemble."""
    rng = random.Random(2026)
    for _ in range(count):
        params = {**base, "ensemble": []}
        params.update({
            "iterations": rng.choice((400, 550, 700, 850, 1000, 1300)),
            "learning_rate": rng.choice((0.02, 0.035, 0.05, 0.07, 0.09)),
            "depth": rng.choice((4, 5, 6, 7, 8)),
            "l2_leaf_reg": rng.choice((3, 6, 10, 16, 25, 40)),
            "random_strength": rng.choice((0, 0.5, 1, 2, 4)),
            "bagging_temperature": rng.choice((0, 1, 2, 4)),
            "loss_function": rng.choice(("MAE", "RMSE")),
            "smoothing": rng.choice((3, 10, 30, 100)),
            "ppsqm_smoothing": rng.choice((3, 10, 30, 100)),
        })
        weight = rng.choice((0.25, 0.5, 0.75))
        params["ensemble"] = [
            {"weight": weight},
            {"weight": 1 - weight, "overrides": {
                "iterations": round(params["iterations"] * rng.choice((0.75, 1, 1.25))),
                "learning_rate": round(params["learning_rate"] * rng.choice((0.5, 0.75, 1)), 5),
                "depth": min(10, params["depth"] + rng.choice((0, 1, 2))),
                "l2_leaf_reg": params["l2_leaf_reg"] * rng.choice((1, 2, 3)),
            }},
        ]
        yield params


def _replace_config(path: Path, content: bytes) -> None:
    temporary = path.with_name(path.name + ".tmp")
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def promote_candidate(package: Path, config: dict) -> None:
    path = package / "config" / "model.json"
    previous = path.read_bytes()
    _replace_config(path, (json.dumps(config, indent=2) + "\n").encode())
    try:
        train(package)
    except BaseException:
        _replace_config(path, previous)
        raise


def tune(package: Path, trials: int = 200) -> dict:
    if trials < 1:
        raise ValueError("--trials must be positive")
    config = json.loads((package / "config" / "model.json").read_text(encoding="utf-8"))
    df = load_data(package.parent.parent / "data" / "raw", minimum_rows=max(20, int(config["cv_splits"]) * 2))
    folds = int(config["cv_splits"])
    cache = {}
    build = package / "build"
    build.mkdir(exist_ok=True)
    history = build / "hypertune-trials.jsonl"
    summary_path = build / "hypertune-summary.json"

    def score(params, seed):
        return evaluation.evaluate_point(
            df, params, folds, seed, train_missing_size=False, matrix_cache=cache
        )["rmsle"]

    baseline = score(config["model"], int(config["seed"]))
    print(f"Current selection RMSLE: {baseline:.5f}", flush=True)
    screened = []
    with history.open("w", encoding="utf-8") as output:
        for index, params in enumerate(candidates(config["model"], trials), start=1):
            rmsle = score(params, SEEDS[0])
            entry = {"trial": index, "seed": SEEDS[0], "selection_rmsle": rmsle, "params": params}
            screened.append(entry)
            output.write(json.dumps(entry) + "\n")
            output.flush()
            print(f"Trial {index}/{trials}: RMSLE {rmsle:.5f}", flush=True)

    finalists = sorted(screened, key=lambda row: row["selection_rmsle"])[:10]
    confirmed = []
    for entry in finalists:
        scores = {str(seed): score(entry["params"], seed) for seed in SEEDS}
        best_seed = min(SEEDS, key=lambda seed: scores[str(seed)])
        confirmed.append({**entry, "seed_scores": scores, "mean_rmsle": sum(scores.values()) / len(scores), "best_seed": best_seed})
    winner = min(confirmed, key=lambda row: row["mean_rmsle"])
    candidate_config = {**config, "seed": winner["best_seed"], "model": winner["params"]}
    summary = {
        "trials": trials,
        "search_seed": 2026,
        "confirmation_seeds": list(SEEDS),
        "baseline_config": config,
        "data_cutoff": str(df["date_posted"].max()),
        "baseline_selection_rmsle": baseline,
        "winner": winner,
        "screened": sorted(screened, key=lambda row: row["selection_rmsle"]),
        "confirmed": sorted(confirmed, key=lambda row: row["mean_rmsle"]),
        "status": "not_improved",
    }

    if winner["mean_rmsle"] < baseline and winner["seed_scores"][str(winner["best_seed"])] < baseline:
        current_report, _ = evaluation.evaluate(df, config["model"], folds, int(config["seed"]), train_missing_size=False)
        candidate_report, _ = evaluation.evaluate(df, winner["params"], folds, winner["best_seed"], train_missing_size=False)
        summary["baseline_test"] = current_report["test"]
        summary["candidate_test"] = candidate_report["test"]
        summary["quality_failures"] = evaluation.quality_failures(candidate_report, config["quality"])
        if summary["quality_failures"]:
            summary["status"] = "quality_gate_failed"
        elif candidate_report["test"]["rmsle"] >= current_report["test"]["rmsle"]:
            summary["status"] = "test_not_improved"
        else:
            try:
                promote_candidate(package, candidate_config)
            except BaseException:
                summary["status"] = "promotion_failed"
                summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
                raise
            summary["status"] = "promoted"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(f"Tuning {summary['status']}; report: {summary_path}")
    return summary

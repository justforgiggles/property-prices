"""Evaluate a development-only package against the original locked test IDs."""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .artifacts import load_model, sha256
from .comparables import comparable_features
from .config import ROOT, PACKAGE
from .data import load_data, split_data


def metrics(actual, prediction):
    actual = np.asarray(actual, float)
    prediction = np.maximum(np.asarray(prediction, float), 1)
    if not len(actual):
        return {"n": 0}
    error = prediction - actual
    percentage_error = abs(error) / actual
    log_error = np.log(prediction) - np.log(actual)
    return dict(
        n=len(actual),
        **{f"within_{tolerance}_pct": float(100 * np.mean(percentage_error <= tolerance / 100))
           for tolerance in [5, 10, 15, 20, 25]},
        mdape=float(100 * np.median(percentage_error)), mae=float(np.mean(abs(error))),
        median_ae=float(np.median(abs(error))), rmse=float(np.sqrt(np.mean(error ** 2))),
        r2=float(1 - np.sum(error ** 2) / np.sum((actual - actual.mean()) ** 2)) if np.var(actual) > 0 else None,
        bias_zar=float(error.mean()), bias_pct=float(100 * np.mean(error / actual)),
        median_signed_pct=float(100 * np.median(error / actual)),
        overprediction_pct=float(100 * np.mean(error > 0)), underprediction_pct=float(100 * np.mean(error < 0)),
        log_rmse=float(np.sqrt(np.mean(log_error ** 2))), log_mae=float(np.mean(abs(log_error))),
    )


def group_interval(predictions):
    mainstream = predictions[predictions.mainstream].copy()
    if mainstream.empty:
        return None
    mainstream["hit"] = abs(mainstream.prediction - mainstream.actual) / mainstream.actual <= 0.2
    groups = mainstream.groupby("group").hit.agg(["sum", "size"]).to_numpy()
    random = np.random.default_rng(618)
    scores = []
    for _ in range(1000):
        sample = groups[random.integers(0, len(groups), len(groups))]
        scores.append(100 * sample[:, 0].sum() / sample[:, 1].sum())
    return np.quantile(scores, [0.025, 0.975]).tolist()


def segment_metrics(test, predictions, comparable):
    frame = test.copy().reset_index(drop=True)
    frame["prediction"] = predictions.prediction
    frame["mainstream"] = predictions.mainstream
    frame["price_band"] = pd.cut(frame.price, [0, 630000, 1000000, 2000000, 5295000, 10000000, np.inf]).astype(str)
    frame["floor_band"] = pd.cut(frame.floor_size, [0, 48, 100, 200, 350, 1000, np.inf]).astype(str)
    frame["rates_band"] = pd.cut(frame.rates, [-1, 0, 400, 1000, 2000, 3000, 10000, np.inf]).astype(str)
    frame["missing_pattern"] = frame.floor_size.isna().map({True: "size_missing", False: "size_present"}) + "|" + frame.rates.isna().map({True: "rates_missing", False: "rates_present"})
    for name in ["suburb_key", "city_key"]:
        frame[name + "_density"] = pd.cut(comparable[f"comp_{name}_n"], [-1, 0, 4, 19, 99, np.inf]).astype(str)
    frame["fallback"] = comparable.comp_fallback
    dimensions = ["province", "city", "bedrooms", "bathrooms", "price_band", "floor_band", "rates_band",
                  "missing_pattern", "suburb_key_density", "city_key_density", "fallback"]
    rows = []
    for cohort, population in [("full", frame), ("mainstream", frame[frame.mainstream])]:
        for dimension in dimensions:
            for value, group in population.groupby(dimension, dropna=False):
                rows.append(dict(cohort=cohort, dimension=dimension, value=str(value),
                                 **metrics(group.price, group.prediction)))
    return pd.DataFrame(rows)


def evaluate_model(model, development, test, output):
    """Measure the frozen recipe without changing it using the reserved test."""
    output = Path(output)
    prediction = model.predict_frame(test)
    if not np.isfinite(prediction).all() or (prediction <= 0).any():
        raise ValueError("Evaluation produced invalid predictions.")
    price_bounds = development.price.quantile([0.1, 0.9]).tolist()
    mainstream = test.price.between(*price_bounds)
    frame = pd.DataFrame(dict(id=test.id, group=test.group, actual=test.price,
                              prediction=prediction, mainstream=mainstream))
    result = dict(training_rows=len(development), test_rows=len(test), mainstream_price_bounds=price_bounds,
                  metrics={"full": metrics(test.price, prediction),
                           "mainstream": metrics(test.price[mainstream], prediction[mainstream])},
                  rounded_mainstream=metrics(test.price[mainstream], np.round(prediction[mainstream], -3)),
                  mainstream_group_bootstrap_95_ci=group_interval(frame))
    comparable = comparable_features(test, model.reference, safe_empty=True)
    output.mkdir(parents=True, exist_ok=True)
    frame.to_csv(output / "predictions.csv", index=False)
    segment_metrics(test, frame, comparable).to_csv(output / "segments.csv", index=False)
    (output / "metrics.json").write_text(json.dumps(result, indent=2))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", default=PACKAGE / "build/evaluation")
    parser.add_argument("--data-dir", default=ROOT / "data/raw")
    parser.add_argument("--splits", default=ROOT / "data/splits.json")
    parser.add_argument("--output-dir", default=PACKAGE / "build/reports")
    args = parser.parse_args()
    try:
        manifest = json.loads((Path(args.model_dir) / "manifest.json").read_text())
        provenance = manifest["provenance"]
        if provenance["population"] != "development":
            raise ValueError("Independent evaluation requires a development-only model, not the all-data production fit.")
        data, audit = load_data(args.data_dir)
        development, test = split_data(data, args.splits)
        if (provenance["training_ids"] != development.id.tolist()
                or provenance["split_sha256"] != sha256(args.splits)
                or provenance["data_audit"]["raw_sha256"] != audit["raw_sha256"]):
            raise ValueError("Model provenance does not match the supplied data and split.")
        output = Path(args.output_dir).resolve()
        if output == (ROOT / "reports/final").resolve():
            raise ValueError("Original evidence is preserved in reports/final; choose another output directory.")
        model = load_model(args.model_dir)
        result = evaluate_model(model, development, test, output)
        print(json.dumps(result, indent=2))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Evaluation failed: {error}\n")


if __name__ == "__main__":
    main()

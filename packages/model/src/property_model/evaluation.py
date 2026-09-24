"""Cross-validated metrics and versioned quality gates."""

from __future__ import annotations

import numpy as np

from . import modeling


def metric_block(y_true, y_pred) -> dict:
    error = y_pred - y_true
    absolute_error = np.abs(error)
    percentage_error = absolute_error / np.clip(np.abs(y_true), 1e-9, None)
    signed_percentage_error = error / np.clip(np.abs(y_true), 1e-9, None)
    log_true = np.log1p(y_true)
    log_pred = np.log1p(np.clip(y_pred, 0, None))
    sum_squared = float(np.sum(error**2))
    total_squared = float(np.sum((y_true - np.mean(y_true)) ** 2))
    log_sum_squared = float(np.sum((log_pred - log_true) ** 2))
    log_total_squared = float(np.sum((log_true - np.mean(log_true)) ** 2))

    return {
        "n": int(len(y_true)),
        "rmse": float(np.sqrt(np.mean(error**2))),
        "mae": float(np.mean(absolute_error)),
        "medae": float(np.median(absolute_error)),
        "rmsle": float(np.sqrt(np.mean((log_pred - log_true) ** 2))),
        "r2": float(1.0 - sum_squared / total_squared),
        "r2_log": float(1.0 - log_sum_squared / log_total_squared),
        "mape": float(np.mean(percentage_error) * 100.0),
        "mdape": float(np.median(percentage_error) * 100.0),
        "median_bias": float(np.median(signed_percentage_error) * 100.0),
        "wape": float(np.sum(absolute_error) / np.sum(np.abs(y_true)) * 100.0),
        "within_10": float(np.mean(percentage_error <= 0.10) * 100.0),
        "within_20": float(np.mean(percentage_error <= 0.20) * 100.0),
    }


def evaluate(
    df, params: dict, cv_splits: int, seed: int, *, train_missing_size: bool = True,
    return_predictions: bool = False,
):
    result = modeling.temporal_cv_predict(
        df,
        params,
        n_splits=cv_splits,
        inner_splits=cv_splits,
        seed=seed,
        quantiles=True,
        train_missing_size=train_missing_size,
        include_features=return_predictions,
    )
    last_fold = int(result["fold"].max())
    selection = result["fold"] <= last_fold - 2
    calibration = result["fold"] == last_fold - 1
    test = result["fold"] == last_fold
    y_log = np.log1p(result["price"])
    widening = modeling.conformal_widen(
        result["lo_log"][calibration], result["hi_log"][calibration], y_log[calibration], alpha=0.23
    )
    low, high = modeling.apply_interval(
        result["lo_log"][test], result["hi_log"][test], widening
    )
    coverage = float(
        np.mean((result["price"][test] >= low) & (result["price"][test] <= high)) * 100.0
    )
    relative_width = float(
        np.median((high - low) / np.clip(result["point"][test], 1e-9, None)) * 100.0
    )
    rows = df.iloc[result["index"][test]].reset_index(drop=True)
    slices = {}
    for column in ("region", "type"):
        slices[column] = {
            str(value): metric_block(
                result["price"][test][rows[column].to_numpy() == value],
                result["point"][test][rows[column].to_numpy() == value],
            )
            for value in sorted(rows[column].unique())
        }
    report = {
        "cv": metric_block(result["price"], result["point"]),
        "selection": metric_block(result["price"][selection], result["point"][selection]),
        "test": metric_block(result["price"][test], result["point"][test]),
        "interval_coverage_pct": coverage,
        "interval_median_relative_width_pct": relative_width,
        "calibration_rows": int(calibration.sum()),
        "test_rows": int(test.sum()),
        "slices": slices,
        "params": params,
    }
    return (report, widening, result) if return_predictions else (report, widening)


def _precise_width_threshold(width, bad, target=0.8):
    order = np.argsort(width)
    accuracy = np.cumsum(~bad[order]) / np.arange(1, len(order) + 1)
    eligible = np.flatnonzero(accuracy >= target)
    if not len(eligible):
        raise ValueError("No calibration threshold reaches precise-tier accuracy")
    count = int(eligible[-1] + 1)
    if count == len(order):
        return float(width[order][-1])
    return float((width[order][count - 1] + width[order][count]) / 2)


def confidence_tiers(risk, width, precise_width, low_risk=0.5):
    low = risk >= low_risk
    high = ~low & (width <= precise_width)
    return np.where(low, "low", np.where(high, "high", "medium"))


def fit_confidence(result: dict, seed: int):
    last_fold = int(result["fold"].max())
    selection = result["fold"] <= last_fold - 2
    calibration = result["fold"] == last_fold - 1
    test = result["fold"] == last_fold
    bad = np.abs(result["point"] - result["price"]) / result["price"] > 0.2
    matrix = modeling.confidence_matrix(
        result["features"], result["point"], result["lo_log"], result["hi_log"]
    )
    model = modeling.fit_confidence(matrix[selection], bad[selection], seed)
    risk = np.clip(model.predict(matrix), 0, 1)
    width = np.abs(result["hi_log"] - result["lo_log"])
    precise_width = _precise_width_threshold(width[calibration], bad[calibration])
    tiers = confidence_tiers(risk, width, precise_width)

    def block(mask):
        cohort = bad[mask]
        return {
            "n": int(mask.sum()),
            "within_20": float(np.mean(~cohort) * 100.0),
        }

    report = {
        "precise_max_quantile_log_width": precise_width,
        "low_min_error_risk": 0.5,
        "calibration": {
            tier: block(calibration & (tiers == tier))
            for tier in ("high", "medium", "low")
        },
        "test": {
            tier: block(test & (tiers == tier))
            for tier in ("high", "medium", "low")
        },
    }
    return model, report


def evaluate_point(
    df, params: dict, cv_splits: int, seed: int, *, train_missing_size: bool = True,
    matrix_cache=None,
) -> dict:
    """Score a point model on selection folds, excluding calibration and test."""
    result = modeling.temporal_cv_predict(
        df, params, n_splits=cv_splits, inner_splits=cv_splits, seed=seed,
        train_missing_size=train_missing_size, selection_only=True,
        matrix_cache=matrix_cache,
    )
    return metric_block(result["price"], result["point"])


def quality_failures(report: dict, quality: dict) -> list[str]:
    failures = []
    metrics = report["test"] if "test" in report else report["cv"]
    if metrics["mdape"] > quality["max_mdape"]:
        failures.append(
            f"MdAPE {metrics['mdape']:.2f}% exceeds {quality['max_mdape']:.2f}%"
        )
    if metrics["r2_log"] < quality["min_r2_log"]:
        failures.append(
            f"log R² {metrics['r2_log']:.3f} is below {quality['min_r2_log']:.3f}"
        )
    if "max_rmsle" in quality and metrics["rmsle"] > quality["max_rmsle"]:
        failures.append(f"RMSLE {metrics['rmsle']:.3f} exceeds {quality['max_rmsle']:.3f}")
    if "min_within_20" in quality and metrics["within_20"] < quality["min_within_20"]:
        failures.append(
            f"within-20% {metrics['within_20']:.2f}% is below {quality['min_within_20']:.2f}%"
        )
    if abs(metrics.get("median_bias", 0.0)) > quality.get("max_abs_median_bias", 5.0):
        failures.append(f"median bias {metrics['median_bias']:.2f}% exceeds ±5.00%")
    coverage = report["interval_coverage_pct"]
    if not quality["min_interval_coverage"] <= coverage <= quality["max_interval_coverage"]:
        failures.append(
            f"interval coverage {coverage:.2f}% is outside "
            f"{quality['min_interval_coverage']:.2f}%-{quality['max_interval_coverage']:.2f}%"
        )
    width = report.get("interval_median_relative_width_pct", 0.0)
    if "max_interval_width" in quality and width > quality["max_interval_width"]:
        failures.append(
            f"median interval width {width:.2f}% exceeds {quality['max_interval_width']:.2f}%"
        )
    confidence = report.get("confidence", {}).get("test")
    if confidence:
        high = confidence["high"]
        low = confidence["low"]
        if high["n"] < quality.get("min_precise_rows", 0):
            failures.append(
                f"precise rows {high['n']} is below {quality['min_precise_rows']}"
            )
        if high["within_20"] < quality.get("min_precise_within_20", 0):
            failures.append(
                f"precise within-20% {high['within_20']:.2f}% is below "
                f"{quality['min_precise_within_20']:.2f}%"
            )
        if low["n"] < quality.get("min_low_confidence_rows", 0):
            failures.append(
                f"low-confidence rows {low['n']} is below "
                f"{quality['min_low_confidence_rows']}"
            )
        if low["within_20"] > quality.get("max_low_confidence_within_20", 100):
            failures.append(
                f"low-confidence within-20% {low['within_20']:.2f}% exceeds "
                f"{quality['max_low_confidence_within_20']:.2f}%"
            )
    return failures


def print_report(report: dict) -> None:
    metrics = report["test"] if "test" in report else report["cv"]
    print(f"Rows                : {metrics['n']}")
    print(f"MdAPE               : {metrics['mdape']:.2f}%")
    print(f"MAPE                : {metrics['mape']:.2f}%")
    print(f"Median bias         : {metrics['median_bias']:.2f}%")
    print(f"Log-space R²        : {metrics['r2_log']:.3f}")
    print(f"Within 10%          : {metrics['within_10']:.1f}%")
    print(f"Interval coverage   : {report['interval_coverage_pct']:.2f}%")
    print(
        "Median interval width: "
        f"{report['interval_median_relative_width_pct']:.1f}% of predicted price"
    )
    if "confidence" in report:
        tiers = report["confidence"]["test"]
        print(
            "Confidence tiers    : "
            + ", ".join(
                f"{name} {values['n']} rows/{values['within_20']:.1f}% within 20%"
                for name, values in tiers.items()
            )
        )

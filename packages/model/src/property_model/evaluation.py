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
    df, params: dict, cv_splits: int, seed: int, *, train_missing_size: bool = True
) -> tuple[dict, float]:
    result = modeling.temporal_cv_predict(
        df,
        params,
        n_splits=cv_splits,
        inner_splits=cv_splits,
        seed=seed,
        quantiles=True,
        train_missing_size=train_missing_size,
    )
    last_fold = int(result["fold"].max())
    selection = result["fold"] <= last_fold - 2
    calibration = result["fold"] == last_fold - 1
    test = result["fold"] == last_fold
    y_log = np.log1p(result["price"])
    widening = modeling.conformal_widen(
        result["lo_log"][calibration], result["hi_log"][calibration], y_log[calibration], alpha=0.2
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
    return report, widening


def evaluate_point(
    df, params: dict, cv_splits: int, seed: int, *, train_missing_size: bool = True
) -> dict:
    """Score one cheap point-model candidate on the final temporal fold."""
    result = modeling.temporal_cv_predict(
        df, params, n_splits=cv_splits, inner_splits=cv_splits, seed=seed,
        train_missing_size=train_missing_size,
    )
    selection = result["fold"] <= result["fold"].max() - 2
    return metric_block(result["price"][selection], result["point"][selection])


def quality_failures(report: dict, quality: dict) -> list[str]:
    failures = []
    metrics = report.get("test", report["cv"])
    if metrics["mdape"] > quality["max_mdape"]:
        failures.append(
            f"MdAPE {metrics['mdape']:.2f}% exceeds {quality['max_mdape']:.2f}%"
        )
    if metrics["r2_log"] < quality["min_r2_log"]:
        failures.append(
            f"log R² {metrics['r2_log']:.3f} is below {quality['min_r2_log']:.3f}"
        )
    if abs(metrics.get("median_bias", 0.0)) > quality.get("max_abs_median_bias", 5.0):
        failures.append(f"median bias {metrics['median_bias']:.2f}% exceeds ±5.00%")
    coverage = report["interval_coverage_pct"]
    if not quality["min_interval_coverage"] <= coverage <= quality["max_interval_coverage"]:
        failures.append(
            f"interval coverage {coverage:.2f}% is outside "
            f"{quality['min_interval_coverage']:.2f}%-{quality['max_interval_coverage']:.2f}%"
        )
    return failures


def print_report(report: dict) -> None:
    metrics = report.get("test", report["cv"])
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

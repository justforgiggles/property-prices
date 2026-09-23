"""CatBoost fitting, cross-validation, and interval calibration."""

import numpy as np
from catboost import CatBoostRegressor, sum_models

from . import features as F

QUANTILE_LOW = "Quantile:alpha=0.1"
QUANTILE_HIGH = "Quantile:alpha=0.9"
CONFIDENCE_EXTRA_ORDER = [
    "point_log",
    "quantile_low_log",
    "quantile_high_log",
    "quantile_log_width",
    "point_minus_low",
    "high_minus_point",
    "point_midpoint_offset",
]
CONFIDENCE_FEATURE_ORDER = F.FEATURE_ORDER + CONFIDENCE_EXTRA_ORDER


def cb_kwargs(params, loss_function=None, seed=42):
    """CatBoost constructor kwargs from a params dict (encoding keys ignored)."""
    return dict(
        iterations=int(params["iterations"]),
        learning_rate=float(params["learning_rate"]),
        depth=int(params["depth"]),
        l2_leaf_reg=float(params["l2_leaf_reg"]),
        min_data_in_leaf=int(params["min_data_in_leaf"]),
        random_strength=float(params["random_strength"]),
        bagging_temperature=float(params["bagging_temperature"]),
        loss_function=loss_function or params["loss_function"],
        random_seed=seed,
        verbose=False,
        allow_writing_files=False,
    )


def _members(params):
    ensemble = params.get("ensemble")
    if not ensemble:
        return [(params, 1.0)]
    base = {key: value for key, value in params.items() if key != "ensemble"}
    members = [({**base, **item.get("overrides", {})}, float(item["weight"])) for item in ensemble]
    total = sum(weight for _, weight in members)
    if total <= 0:
        raise ValueError("Ensemble weights must have a positive sum")
    return [(member, weight / total) for member, weight in members]


def _combine(models, weights):
    return models[0] if len(models) == 1 else sum_models(models, weights=weights)


def fit_point(X, y_log, params, seed=42, sample_weight=None):
    members = _members(params)
    models = [
        CatBoostRegressor(**cb_kwargs(member, seed=seed)).fit(
            X, y_log, sample_weight=sample_weight
        )
        for member, _ in members
    ]
    return _combine(models, [weight for _, weight in members])


def fit_quantiles(X, y_log, params, seed=42, sample_weight=None):
    members = _members(params)
    weights = [weight for _, weight in members]
    low = [
        CatBoostRegressor(**cb_kwargs(member, loss_function=QUANTILE_LOW, seed=seed)).fit(
            X, y_log, sample_weight=sample_weight
        )
        for member, _ in members
    ]
    high = [
        CatBoostRegressor(**cb_kwargs(member, loss_function=QUANTILE_HIGH, seed=seed)).fit(
            X, y_log, sample_weight=sample_weight
        )
        for member, _ in members
    ]
    return _combine(low, weights), _combine(high, weights)


def confidence_matrix(X, point, lo_log, hi_log):
    point_log = np.log1p(np.clip(point, 0, None))
    low = np.minimum(lo_log, hi_log)
    high = np.maximum(lo_log, hi_log)
    extra = np.column_stack([
        point_log,
        low,
        high,
        high - low,
        point_log - low,
        high - point_log,
        np.abs(point_log - (low + high) / 2),
    ])
    return np.column_stack([X, extra]).astype(np.float32)


def fit_confidence(X, bad, seed=42):
    """Fit a scalar tail-risk score that exports as a plain ONNX tensor."""
    return CatBoostRegressor(
        iterations=300,
        learning_rate=0.03,
        depth=3,
        l2_leaf_reg=20,
        loss_function="RMSE",
        random_seed=seed,
        verbose=False,
        allow_writing_files=False,
    ).fit(X, bad.astype(float))


def training_weights(X, params):
    missing_weight = float(params.get("missing_rates_weight", 1.0))
    if not 0 < missing_weight <= 1:
        raise ValueError("missing_rates_weight must be in (0, 1]")
    missing = X[:, F.FEATURE_ORDER.index("rates_and_taxes_missing")]
    return np.where(missing == 1, missing_weight, 1.0)


def _temporal_folds(df, n_splits):
    """Expanding-window folds; a publication date never crosses a boundary."""
    if "date_posted" not in df:
        raise ValueError("Temporal evaluation requires date_posted")
    ordered = df.sort_values("date_posted", kind="stable")
    dates = ordered["date_posted"].to_numpy()
    boundaries = []
    for position in np.linspace(0, len(ordered), n_splits + 2, dtype=int)[1:-1]:
        if position < len(dates):
            boundaries.append(dates[position])
    boundaries = sorted(set(boundaries))
    folds = []
    for index, start in enumerate(boundaries):
        end = boundaries[index + 1] if index + 1 < len(boundaries) else None
        train = df.index[df["date_posted"] < start].to_numpy()
        validation_mask = df["date_posted"] >= start
        if end is not None:
            validation_mask &= df["date_posted"] < end
        validation_mask &= df[
            [F.SIZE_COL, "bedrooms", "bathrooms", "rates_and_taxes"]
        ].notna().all(axis=1)
        validation = df.index[validation_mask].to_numpy()
        if len(train) >= 20 and len(validation):
            folds.append((train, validation))
    if len(folds) < 3:
        raise ValueError("Expected at least three usable temporal folds")
    return folds


def temporal_cv_predict(
    df, params, n_splits=5, inner_splits=5, seed=42, quantiles=False,
    train_missing_size=True, selection_only=False, matrix_cache=None,
    include_features=False,
):
    """Forward predictions from expanding publication-date windows.

    Missing-size and missing-rates rows may enrich training, but validation
    mirrors the serving contract and contains only complete known-rates rows.
    """
    df = df.reset_index(drop=True)
    sm = float(params["smoothing"])
    pp = float(params["ppsqm_smoothing"])
    output = {"point": [], "price": [], "fold": [], "index": []}
    if quantiles:
        output.update({"lo_log": [], "hi_log": []})
    if include_features:
        output["features"] = []

    folds = _temporal_folds(df, n_splits)
    if selection_only:
        folds = folds[:-2]
    for fold_number, (train_idx, val_idx) in enumerate(folds):
        key = (fold_number, sm, pp, seed, inner_splits, train_missing_size)
        if matrix_cache is not None and key in matrix_cache:
            X_tr, y_tr, X_va = matrix_cache[key]
        else:
            prior = df.iloc[train_idx].reset_index(drop=True)
            model_ready = prior[["bedrooms", "bathrooms"]].notna().all(axis=1)
            if not train_missing_size:
                model_ready &= prior[F.SIZE_COL].notna()
            tr = prior[model_ready].reset_index(drop=True)
            va = df.iloc[val_idx]
            enc = F.fit_encoders(prior, sm, pp)
            X_tr = F.build_oof_matrix(tr, inner_splits, seed, sm, pp, prior_df=prior)
            y_tr = np.log1p(tr[F.TARGET_COL].to_numpy(dtype=float))
            X_va = F.build_matrix(va, enc)
            if matrix_cache is not None:
                matrix_cache[key] = (X_tr, y_tr, X_va)

        va = df.iloc[val_idx]

        sample_weight = training_weights(X_tr, params)
        output["point"].extend(
            np.expm1(
                fit_point(X_tr, y_tr, params, seed, sample_weight).predict(X_va)
            )
        )
        output["price"].extend(va[F.TARGET_COL].to_numpy(dtype=float))
        output["fold"].extend([fold_number] * len(va))
        output["index"].extend(val_idx)
        if include_features:
            output["features"].extend(X_va)
        if quantiles:
            m_lo, m_hi = fit_quantiles(X_tr, y_tr, params, seed, sample_weight)
            output["lo_log"].extend(m_lo.predict(X_va))
            output["hi_log"].extend(m_hi.predict(X_va))
    return {name: np.asarray(values) for name, values in output.items()}


def conformal_widen(lo_log, hi_log, y_log, alpha=0.2):
    """CQR widening so a [q_lo, q_hi] band reaches (1-alpha) coverage.

    Returns the log-space amount to subtract from q_lo and add to q_hi.
    """
    a = np.minimum(lo_log, hi_log)
    b = np.maximum(lo_log, hi_log)
    scores = np.maximum(a - y_log, y_log - b)
    n = len(scores)
    q = min(1.0, np.ceil((n + 1) * (1 - alpha)) / n)
    return max(0.0, float(np.quantile(scores, q, method="higher")))


def apply_interval(lo_log, hi_log, widen):
    """Calibrated price band from log-space quantiles and a widening amount."""
    a = np.minimum(lo_log, hi_log)
    b = np.maximum(lo_log, hi_log)
    return np.maximum(0.0, np.expm1(a - widen)), np.expm1(b + widen)

"""CatBoost fitting, cross-validation, and interval calibration."""

import numpy as np
from catboost import CatBoostRegressor, sum_models

from . import features as F

QUANTILE_LOW = "Quantile:alpha=0.1"
QUANTILE_HIGH = "Quantile:alpha=0.9"


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


def fit_point(X, y_log, params, seed=42):
    members = _members(params)
    models = [CatBoostRegressor(**cb_kwargs(member, seed=seed)).fit(X, y_log) for member, _ in members]
    return _combine(models, [weight for _, weight in members])


def fit_quantiles(X, y_log, params, seed=42):
    members = _members(params)
    weights = [weight for _, weight in members]
    low = [
        CatBoostRegressor(**cb_kwargs(member, loss_function=QUANTILE_LOW, seed=seed)).fit(X, y_log)
        for member, _ in members
    ]
    high = [
        CatBoostRegressor(**cb_kwargs(member, loss_function=QUANTILE_HIGH, seed=seed)).fit(X, y_log)
        for member, _ in members
    ]
    return _combine(low, weights), _combine(high, weights)


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
        validation_mask &= df[[F.SIZE_COL, "bedrooms", "bathrooms"]].notna().all(axis=1)
        validation = df.index[validation_mask].to_numpy()
        if len(train) >= 20 and len(validation):
            folds.append((train, validation))
    if len(folds) < 3:
        raise ValueError("Expected at least three usable temporal folds")
    return folds


def temporal_cv_predict(
    df, params, n_splits=5, inner_splits=5, seed=42, quantiles=False,
    train_missing_size=True,
):
    """Forward predictions from expanding publication-date windows.

    Missing-size rows may enrich training, but validation mirrors the serving
    contract and therefore contains only rows with an observed floor size.
    """
    df = df.reset_index(drop=True)
    sm = float(params["smoothing"])
    pp = float(params["ppsqm_smoothing"])
    output = {"point": [], "price": [], "fold": [], "index": []}
    if quantiles:
        output.update({"lo_log": [], "hi_log": []})

    for fold_number, (train_idx, val_idx) in enumerate(_temporal_folds(df, n_splits)):
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

        output["point"].extend(np.expm1(fit_point(X_tr, y_tr, params, seed).predict(X_va)))
        output["price"].extend(va[F.TARGET_COL].to_numpy(dtype=float))
        output["fold"].extend([fold_number] * len(va))
        output["index"].extend(val_idx)
        if quantiles:
            m_lo, m_hi = fit_quantiles(X_tr, y_tr, params, seed)
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

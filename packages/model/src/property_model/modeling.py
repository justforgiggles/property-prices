"""CatBoost fitting, cross-validation, and interval calibration."""

import numpy as np
from catboost import CatBoostRegressor

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


def fit_point(X, y_log, params, seed=42):
    return CatBoostRegressor(**cb_kwargs(params, seed=seed)).fit(X, y_log)


def fit_quantiles(X, y_log, params, seed=42):
    lo = CatBoostRegressor(
        **cb_kwargs(params, loss_function=QUANTILE_LOW, seed=seed)
    ).fit(X, y_log)
    hi = CatBoostRegressor(
        **cb_kwargs(params, loss_function=QUANTILE_HIGH, seed=seed)
    ).fit(X, y_log)
    return lo, hi


def _kfolds(n, n_splits, seed):
    rng = np.random.default_rng(seed)
    return np.array_split(rng.permutation(n), n_splits)


def nested_cv_predict(
    df, params, n_splits=5, inner_splits=5, seed=42, quantiles=False
):
    """Out-of-fold predictions over every row, with honest encoding.

    For each outer fold: fit serving encoders on outer-train, OOF-encode
    outer-train to train the model, encode outer-val with the outer-train
    encoders, predict. No outer-val target ever touches the features or the
    model it is scored against. Returns arrays aligned to df.reset_index order.
    """
    df = df.reset_index(drop=True)
    n = len(df)
    price = df[F.TARGET_COL].to_numpy(dtype=float)
    sm = float(params["smoothing"])
    pp = float(params["ppsqm_smoothing"])

    point = np.zeros(n)
    lo_log = np.zeros(n)
    hi_log = np.zeros(n)

    for fold in _kfolds(n, n_splits, seed):
        # Sort val indices so predicted rows align with the positions written.
        val_idx = np.sort(fold)
        train_mask = np.ones(n, dtype=bool)
        train_mask[val_idx] = False
        tr = df.iloc[train_mask].reset_index(drop=True)
        va = df.iloc[val_idx]

        enc = F.fit_encoders(tr, sm, pp)
        X_tr = F.build_oof_matrix(tr, inner_splits, seed, sm, pp)
        y_tr = np.log1p(tr[F.TARGET_COL].to_numpy(dtype=float))
        X_va = F.build_matrix(va, enc)

        point[val_idx] = np.expm1(fit_point(X_tr, y_tr, params, seed).predict(X_va))
        if quantiles:
            m_lo, m_hi = fit_quantiles(X_tr, y_tr, params, seed)
            lo_log[val_idx] = m_lo.predict(X_va)
            hi_log[val_idx] = m_hi.predict(X_va)

    if quantiles:
        # Return raw log-space quantiles so the caller can conformally calibrate.
        return {"point": point, "price": price, "lo_log": lo_log, "hi_log": hi_log}
    return {"point": point, "price": price}


def conformal_widen(lo_log, hi_log, y_log, alpha=0.2):
    """CQR widening so a [q_lo, q_hi] band reaches (1-alpha) coverage.

    Returns the log-space amount to subtract from q_lo and add to q_hi.
    """
    a = np.minimum(lo_log, hi_log)
    b = np.maximum(lo_log, hi_log)
    scores = np.maximum(a - y_log, y_log - b)
    n = len(scores)
    q = min(1.0, np.ceil((n + 1) * (1 - alpha)) / n)
    return float(np.quantile(scores, q, method="higher"))


def apply_interval(lo_log, hi_log, widen):
    """Calibrated price band from log-space quantiles and a widening amount."""
    a = np.minimum(lo_log, hi_log)
    b = np.maximum(lo_log, hi_log)
    return np.expm1(a - widen), np.expm1(b + widen)

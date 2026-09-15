"""Shared feature pipeline for training and inference.

Both training and inference import this module, so the exact same feature
engineering runs in Python. ``tests/verify-onnx.js`` mirrors the inference
transform against the generated ``encoders.json`` to protect the consumer
contract.

Design notes:
- CatBoost cannot export categorical features to ONNX, so every categorical
  field is turned into a number here (smoothed target encoding). The model sees
  a single ``float32`` matrix, which CatBoost and onnxruntime-node both handle.
- High-cardinality geography (``locality_2`` is mostly singletons) leaks badly
  under naive target encoding. Training uses ``build_oof_matrix`` (out-of-fold
  encoding) so a row is never encoded with its own target; serving uses
  ``fit_encoders`` (full-train statistics). This split is the standard fix.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

import numpy as np

TARGET_COL = "price"
SIZE_COL = "size"
SMOOTHING = 20.0
PPSQM_SMOOTHING = 20.0

# Fixed model feature order. Persisted in encoders.json and mirrored in Node.
FEATURE_ORDER = [
    "bedrooms",
    "bathrooms",
    "size",
    "total_rooms",
    "bed_bath_ratio",
    "size_per_bedroom",
    "log_size",
    "te_country",
    "te_region",
    "te_locality_1",
    "te_locality_2",
    "te_type",
    "te_ppsqm",
    "prior_log_price",
    "loc2_log_count",
]

@dataclass
class Encoders:
    """Fitted lookup tables plus the fixed feature order.

    ``target_encoding`` holds smoothed mean ``log1p(price)`` per category;
    ``ppsqm_encoding`` holds smoothed mean ``log(price/size)`` per location;
    ``loc2_count`` holds how many listings each locality_2 had when fit.
    """

    global_mean: float
    smoothing: float
    target_encoding: dict
    global_ppsqm: float
    ppsqm_smoothing: float
    ppsqm_encoding: dict
    loc2_count: dict
    feature_order: list
    # Conformal widening (log space) applied to the quantile band so the
    # P10-P90 interval reaches its target coverage. Set by the pipeline.
    interval_log_widen: float = 0.0

    def to_dict(self):
        return {
            "feature_order": self.feature_order,
            "global_mean": self.global_mean,
            "smoothing": self.smoothing,
            "target_encoding": self.target_encoding,
            "global_ppsqm": self.global_ppsqm,
            "ppsqm_smoothing": self.ppsqm_smoothing,
            "ppsqm_encoding": self.ppsqm_encoding,
            "loc2_count": self.loc2_count,
            "interval_log_widen": self.interval_log_widen,
        }

    @classmethod
    def from_dict(cls, d):
        return cls(
            global_mean=float(d["global_mean"]),
            smoothing=float(d["smoothing"]),
            target_encoding=d["target_encoding"],
            global_ppsqm=float(d["global_ppsqm"]),
            ppsqm_smoothing=float(d["ppsqm_smoothing"]),
            ppsqm_encoding=d["ppsqm_encoding"],
            loc2_count={str(k): int(v) for k, v in d["loc2_count"].items()},
            feature_order=list(d["feature_order"]),
            interval_log_widen=float(d.get("interval_log_widen", 0.0)),
        )


def fit_encoders(train_df, smoothing=SMOOTHING, ppsqm_smoothing=PPSQM_SMOOTHING):
    """Fit smoothed, hierarchical target encoders on a training set.

    Each category is encoded by the mean of the quantity (log-price or
    log-ppsqm) over its rows, shrunk toward a parent mean so rare categories do
    not overfit:  ``te = (n * mean + m * parent) / (n + m)``. Parents follow the
    geography: locality_2 -> locality_1 -> region -> global.
    """
    df = train_df.copy()
    price = df[TARGET_COL].to_numpy(dtype=float)
    size = np.clip(df[SIZE_COL].to_numpy(dtype=float), 1e-9, None)
    df["_y"] = np.log1p(price)
    df["_yp"] = np.log(price / size)  # log price-per-m^2

    global_mean = float(df["_y"].mean())
    global_ppsqm = float(df["_yp"].mean())

    region_mean = df.groupby("region")["_y"].mean()
    locality1_mean = df.groupby("locality_1")["_y"].mean()
    region_ppsqm = df.groupby("region")["_yp"].mean()
    locality1_ppsqm = df.groupby("locality_1")["_yp"].mean()

    loc1_to_region = df.groupby("locality_1")["region"].agg(lambda s: s.mode().iat[0])
    loc2_to_loc1 = df.groupby("locality_2")["locality_1"].agg(lambda s: s.mode().iat[0])

    def encode(col, ycol, parent_for, m):
        stats = df.groupby(col)[ycol].agg(["count", "mean"])
        out = {}
        for value, row in stats.iterrows():
            n = float(row["count"])
            mean_value = float(row["mean"])
            parent = float(parent_for(value))
            out[str(value)] = (n * mean_value + m * parent) / (n + m)
        return out

    target_encoding = {
        "country": encode("country", "_y", lambda v: global_mean, smoothing),
        "region": encode("region", "_y", lambda v: global_mean, smoothing),
        "type": encode("type", "_y", lambda v: global_mean, smoothing),
        "locality_1": encode(
            "locality_1", "_y",
            lambda v: region_mean.get(loc1_to_region.get(v), global_mean), smoothing,
        ),
        "locality_2": encode(
            "locality_2", "_y",
            lambda v: locality1_mean.get(loc2_to_loc1.get(v), global_mean), smoothing,
        ),
    }
    ppsqm_encoding = {
        "region": encode("region", "_yp", lambda v: global_ppsqm, ppsqm_smoothing),
        "locality_1": encode(
            "locality_1", "_yp",
            lambda v: region_ppsqm.get(loc1_to_region.get(v), global_ppsqm), ppsqm_smoothing,
        ),
        "locality_2": encode(
            "locality_2", "_yp",
            lambda v: locality1_ppsqm.get(loc2_to_loc1.get(v), global_ppsqm), ppsqm_smoothing,
        ),
    }
    loc2_count = {str(k): int(v) for k, v in df.groupby("locality_2").size().items()}

    return Encoders(
        global_mean=global_mean,
        smoothing=float(smoothing),
        target_encoding=target_encoding,
        global_ppsqm=global_ppsqm,
        ppsqm_smoothing=float(ppsqm_smoothing),
        ppsqm_encoding=ppsqm_encoding,
        loc2_count=loc2_count,
        feature_order=list(FEATURE_ORDER),
    )


def _lookup(table_map, default, col, value, fallbacks):
    """Encoded value for ``value`` in ``col``, falling back up the hierarchy."""
    table = table_map.get(col, {})
    if str(value) in table:
        return table[str(value)]
    for fb_col, fb_value in fallbacks:
        fb_table = table_map.get(fb_col, {})
        if str(fb_value) in fb_table:
            return fb_table[str(fb_value)]
    return default


def record_to_features(rec, enc):
    """Turn one raw listing dict into the ordered numeric feature list."""
    bedrooms = float(rec["bedrooms"])
    bathrooms = float(rec["bathrooms"])
    size = float(rec["size"])
    log_size = math.log(max(size, 1e-9))

    region_fb = [("region", rec["region"])]
    loc2_fb = [("locality_1", rec["locality_1"]), ("region", rec["region"])]

    te_ppsqm = _lookup(
        enc.ppsqm_encoding,
        enc.global_ppsqm,
        "locality_2",
        rec["locality_2"],
        loc2_fb,
    )

    feats = {
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "size": size,
        "total_rooms": bedrooms + bathrooms,
        "bed_bath_ratio": bedrooms / (bathrooms + 0.5),
        "size_per_bedroom": size / max(bedrooms, 0.5),
        "log_size": log_size,
        "te_country": _lookup(enc.target_encoding, enc.global_mean, "country", rec["country"], []),
        "te_region": _lookup(enc.target_encoding, enc.global_mean, "region", rec["region"], []),
        "te_locality_1": _lookup(
            enc.target_encoding,
            enc.global_mean,
            "locality_1",
            rec["locality_1"],
            region_fb,
        ),
        "te_locality_2": _lookup(
            enc.target_encoding,
            enc.global_mean,
            "locality_2",
            rec["locality_2"],
            loc2_fb,
        ),
        "te_type": _lookup(enc.target_encoding, enc.global_mean, "type", rec["type"], []),
        "te_ppsqm": te_ppsqm,
        "prior_log_price": te_ppsqm + log_size,  # implied log-price from $/m^2 * size
        "loc2_log_count": math.log1p(enc.loc2_count.get(str(rec["locality_2"]), 0)),
    }
    return [float(feats[name]) for name in enc.feature_order]


def build_matrix(df, enc):
    """Build a ``float32`` feature matrix from a DataFrame of listings."""
    rows = [record_to_features(rec, enc) for rec in df.to_dict(orient="records")]
    return np.asarray(rows, dtype=np.float32)


def build_oof_matrix(
    train_df,
    n_splits=5,
    seed=42,
    smoothing=SMOOTHING,
    ppsqm_smoothing=PPSQM_SMOOTHING,
):
    """Out-of-fold encoded feature matrix for training the model.

    Each row is encoded with encoders fit on the *other* folds, so a row's own
    target never enters its features. This is the standard cure for target-
    encoding leakage on sparse high-cardinality categories.
    """
    df = train_df.reset_index(drop=True)
    n = len(df)
    X = np.zeros((n, len(FEATURE_ORDER)), dtype=np.float32)
    rng = np.random.default_rng(seed)
    for fold in np.array_split(rng.permutation(n), n_splits):
        # Sort the validation indices so the rows we read line up with the
        # positions we write back to (iloc with a boolean mask returns rows in
        # ascending order regardless of fold order).
        val_idx = np.sort(fold)
        train_mask = np.ones(n, dtype=bool)
        train_mask[val_idx] = False
        enc = fit_encoders(df.iloc[train_mask], smoothing, ppsqm_smoothing)
        rows = [record_to_features(rec, enc) for rec in df.iloc[val_idx].to_dict(orient="records")]
        X[val_idx] = np.asarray(rows, dtype=np.float32)
    return X


def save_encoders(enc, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(enc.to_dict(), fh, indent=2)


def load_encoders(path):
    with open(path, "r", encoding="utf-8") as fh:
        return Encoders.from_dict(json.load(fh))

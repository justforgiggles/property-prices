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
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

TARGET_COL = "price"
SIZE_COL = "size"
SMOOTHING = 20.0
PPSQM_SMOOTHING = 20.0

# Fixed model feature order. Persisted in encoders.json and mirrored in Node.
FEATURE_ORDER = [
    "bedrooms",
    "bathrooms",
    "size",
    "size_missing",
    "total_rooms",
    "bed_bath_ratio",
    "size_per_bedroom",
    "log_size",
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
    size_imputation: dict = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)

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
            "size_imputation": self.size_imputation,
            "metadata": self.metadata,
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
            size_imputation=d.get("size_imputation", {}),
            metadata=d.get("metadata", {}),
        )


def _key(*values):
    return "|".join(str(value) for value in values)


def _geo_values(rec, composite=True):
    region = str(rec["region"])
    city = str(rec["locality_1"])
    suburb = str(rec["locality_2"])
    if not composite:
        return region, city, suburb
    return region, _key(region, city), _key(region, city, suburb)


def _size_imputation(df, valid_size):
    actual = df.loc[valid_size].copy()
    if actual.empty:
        return {"global": 1.0}
    actual[SIZE_COL] = actual[SIZE_COL].astype(float)
    levels = {
        "region_city_suburb_type": ["region", "locality_1", "locality_2", "type"],
        "region_city_type": ["region", "locality_1", "type"],
        "region_type": ["region", "type"],
        "type": ["type"],
    }
    result = {"global": float(actual[SIZE_COL].median())}
    for name, columns in levels.items():
        medians = actual.groupby(columns, dropna=False)[SIZE_COL].median()
        result[name] = {
            _key(*(index if isinstance(index, tuple) else (index,))): float(value)
            for index, value in medians.items()
        }
    return result


def _impute_size(rec, imputation):
    candidates = (
        ("region_city_suburb_type", _key(rec["region"], rec["locality_1"], rec["locality_2"], rec["type"])),
        ("region_city_type", _key(rec["region"], rec["locality_1"], rec["type"])),
        ("region_type", _key(rec["region"], rec["type"])),
        ("type", str(rec["type"])),
    )
    for level, key in candidates:
        value = imputation.get(level, {}).get(key)
        if value is not None:
            return float(value)
    return float(imputation.get("global", 1.0))


def fit_encoders(train_df, smoothing=SMOOTHING, ppsqm_smoothing=PPSQM_SMOOTHING):
    """Fit smoothed, hierarchical target encoders on a training set.

    Each category is encoded by the mean of the quantity (log-price or
    log-ppsqm) over its rows, shrunk toward a parent mean so rare categories do
    not overfit:  ``te = (n * mean + m * parent) / (n + m)``. Parents follow the
    geography: locality_2 -> locality_1 -> region -> global.
    """
    df = train_df.copy()
    price = df[TARGET_COL].to_numpy(dtype=float)
    size = df[SIZE_COL].to_numpy(dtype=float)
    valid_size = np.isfinite(size) & (size > 0)
    df["_y"] = np.log1p(price)
    df["_region_key"] = df["region"].astype(str)
    df["_city_key"] = df[["region", "locality_1"]].astype(str).agg("|".join, axis=1)
    df["_suburb_key"] = df[["region", "locality_1", "locality_2"]].astype(str).agg("|".join, axis=1)

    global_mean = float(df["_y"].mean())
    region_mean = df.groupby("_region_key")["_y"].mean()
    city_mean = df.groupby("_city_key")["_y"].mean()

    city_to_region = df.groupby("_city_key")["_region_key"].first()
    suburb_to_city = df.groupby("_suburb_key")["_city_key"].first()

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
        "region": encode("_region_key", "_y", lambda v: global_mean, smoothing),
        "type": encode("type", "_y", lambda v: global_mean, smoothing),
        "locality_1": encode(
            "_city_key", "_y",
            lambda v: region_mean.get(city_to_region.get(v), global_mean), smoothing,
        ),
        "locality_2": encode(
            "_suburb_key", "_y",
            lambda v: city_mean.get(suburb_to_city.get(v), global_mean), smoothing,
        ),
    }

    ppsqm = df.loc[valid_size].copy()
    ppsqm["_yp"] = np.log(ppsqm[TARGET_COL].to_numpy(dtype=float) / ppsqm[SIZE_COL].to_numpy(dtype=float))
    ppsqm["_weight"] = 1.0
    if "date_posted" in ppsqm:
        dates = pd.to_datetime(ppsqm["date_posted"], errors="coerce")
        if dates.notna().any():
            age = (dates.max() - dates).dt.total_seconds() / 86400
            ppsqm.loc[dates.notna(), "_weight"] = np.exp(-math.log(2) * age[dates.notna()] / 90)

    def weighted_mean(frame):
        return float(np.average(frame["_yp"], weights=frame["_weight"]))

    def weighted_means(col):
        return ppsqm.groupby(col).apply(weighted_mean, include_groups=False)

    def weighted_encode(col, parent_for):
        out = {}
        for value, rows in ppsqm.groupby(col):
            weight = float(rows["_weight"].sum())
            out[str(value)] = (weight * weighted_mean(rows) + ppsqm_smoothing * float(parent_for(value))) / (weight + ppsqm_smoothing)
        return out

    if ppsqm.empty:
        global_ppsqm = 0.0
        ppsqm_encoding = {"region": {}, "locality_1": {}, "locality_2": {}}
    else:
        global_ppsqm = weighted_mean(ppsqm)
        region_ppsqm = weighted_means("_region_key")
        city_ppsqm = weighted_means("_city_key")
        ppsqm_encoding = {
            "region": weighted_encode("_region_key", lambda v: global_ppsqm),
            "locality_1": weighted_encode("_city_key", lambda v: region_ppsqm.get(city_to_region.get(v), global_ppsqm)),
            "locality_2": weighted_encode("_suburb_key", lambda v: city_ppsqm.get(suburb_to_city.get(v), global_ppsqm)),
        }
    loc2_count = {str(k): int(v) for k, v in df.groupby("_suburb_key").size().items()}

    return Encoders(
        global_mean=global_mean,
        smoothing=float(smoothing),
        target_encoding=target_encoding,
        global_ppsqm=global_ppsqm,
        ppsqm_smoothing=float(ppsqm_smoothing),
        ppsqm_encoding=ppsqm_encoding,
        loc2_count=loc2_count,
        feature_order=list(FEATURE_ORDER),
        size_imputation=_size_imputation(df, valid_size),
        metadata={"geography_keys": "composite_v1", "ppsqm_half_life_days": 90},
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
    try:
        raw_size = float(rec.get("size"))
    except (TypeError, ValueError):
        raw_size = math.nan
    size_missing = float(not math.isfinite(raw_size) or raw_size <= 0)
    size = _impute_size(rec, enc.size_imputation) if size_missing else raw_size
    log_size = math.log(max(size, 1e-9))

    region, city, suburb = _geo_values(rec, enc.metadata.get("geography_keys") == "composite_v1")

    region_fb = [("region", region)]
    loc2_fb = [("locality_1", city), ("region", region)]

    te_ppsqm = _lookup(
        enc.ppsqm_encoding,
        enc.global_ppsqm,
        "locality_2",
        suburb,
        loc2_fb,
    )

    feats = {
        "bedrooms": bedrooms,
        "bathrooms": bathrooms,
        "size": size,
        "size_missing": size_missing,
        "total_rooms": bedrooms + bathrooms,
        "bed_bath_ratio": bedrooms / (bathrooms + 0.5),
        "size_per_bedroom": size / max(bedrooms, 0.5),
        "log_size": log_size,
        # Retained only so pre-upgrade bundles with te_country remain loadable.
        "te_country": _lookup(enc.target_encoding, enc.global_mean, "country", rec.get("country", "South Africa"), []),
        "te_region": _lookup(enc.target_encoding, enc.global_mean, "region", region, []),
        "te_locality_1": _lookup(
            enc.target_encoding,
            enc.global_mean,
            "locality_1",
            city,
            region_fb,
        ),
        "te_locality_2": _lookup(
            enc.target_encoding,
            enc.global_mean,
            "locality_2",
            suburb,
            loc2_fb,
        ),
        "te_type": _lookup(enc.target_encoding, enc.global_mean, "type", rec["type"], []),
        "te_ppsqm": te_ppsqm,
        "prior_log_price": te_ppsqm + log_size,  # implied log-price from $/m^2 * size
        "loc2_log_count": math.log1p(enc.loc2_count.get(suburb, 0)),
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
    prior_df=None,
):
    """Out-of-fold encoded feature matrix for training the model.

    Each row is encoded with encoders fit on the *other* folds, so a row's own
    target never enters its features. This is the standard cure for target-
    encoding leakage on sparse high-cardinality categories.
    """
    df = train_df.reset_index(drop=True)
    prior = df if prior_df is None else prior_df.reset_index(drop=True)
    n = len(df)
    X = np.zeros((n, len(FEATURE_ORDER)), dtype=np.float32)
    if "date_posted" in df:
        dates = pd.to_datetime(df["date_posted"], errors="coerce")
        if dates.isna().any():
            raise ValueError("date_posted must be valid for chronological encoding")
        unique_dates = np.sort(dates.unique())
        # Only the first date lacks historical data; keep that cold-start
        # block small rather than assigning neutral encodings to 1/n_splits.
        folds = [np.flatnonzero(dates == unique_dates[0])]
        for date_block in np.array_split(unique_dates[1:], n_splits):
            if len(date_block):
                folds.append(np.flatnonzero(dates.isin(date_block)))
    else:
        rng = np.random.default_rng(seed)
        folds = np.array_split(rng.permutation(n), n_splits)
    for fold in folds:
        # Sort the validation indices so the rows we read line up with the
        # positions we write back to (iloc with a boolean mask returns rows in
        # ascending order regardless of fold order).
        val_idx = np.sort(fold)
        if "date_posted" in df:
            prior_dates = pd.to_datetime(prior["date_posted"], errors="coerce")
            train_mask = prior_dates < dates.iloc[val_idx].min()
        else:
            validation_ids = set(df.iloc[val_idx].get("id", []))
            train_mask = ~prior.get("id", pd.Series(range(len(prior)))).isin(validation_ids)
        if train_mask.any():
            enc = fit_encoders(prior.loc[train_mask], smoothing, ppsqm_smoothing)
        else:
            enc = Encoders(0.0, float(smoothing), {}, 0.0, float(ppsqm_smoothing), {}, {}, list(FEATURE_ORDER))
        rows = [record_to_features(rec, enc) for rec in df.iloc[val_idx].to_dict(orient="records")]
        X[val_idx] = np.asarray(rows, dtype=np.float32)
    return X


def save_encoders(enc, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(enc.to_dict(), fh, indent=2)


def load_encoders(path):
    with open(path, "r", encoding="utf-8") as fh:
        return Encoders.from_dict(json.load(fh))

"""The fixed 70-feature matrix, training-only summaries and grouped cross-fitting."""
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from .comparables import comparable_features, numeric_coordinates
from .config import (FEATURE_COLUMNS, INNER_FOLDS, INNER_SEED, LOCATIONS,
                     NUMERIC, RATIOS, SHRINKAGE, SIZE_EDGES, SUMMARY_KEYS)


def size_bands(area):
    return pd.cut(area, SIZE_EDGES).astype(str).fillna("__unknown__")


def structural_features(frame):
    features = frame[LOCATIONS + NUMERIC].copy().reset_index(drop=True)
    for column in LOCATIONS:
        features[column] = features[column].fillna("__unknown__").astype(str)
    for column in NUMERIC:
        features[column + "_missing"] = features[column].isna().astype(int)
        features["log_" + column] = np.log1p(features[column])
    for numerator, denominator in RATIOS:
        features[numerator + "_per_" + denominator] = features[numerator] / features[denominator].replace(0, np.nan)
    features["rooms_product"] = features.bedrooms * features.bathrooms
    features["size_band"] = size_bands(features.floor_size)
    return features


def summary_keys(frame):
    frame = frame.copy()
    bedrooms = frame.bedrooms.fillna(-1).astype(str)
    bathrooms = frame.bathrooms.fillna(-1).astype(str)
    frame["bed_key"] = frame.suburb_key + "|" + bedrooms
    frame["config_key"] = frame.city_key + "|" + bedrooms + "|" + bathrooms
    frame["size_key"] = frame.city_key + "|" + size_bands(frame.floor_size)
    return frame


def build_reference(training):
    """Plain data only: saved artifacts do not depend on our Python class locations."""
    if training.empty:
        raise ValueError("Cannot build a market reference from an empty population.")
    pool = summary_keys(training[LOCATIONS + NUMERIC + ["price"]].reset_index(drop=True))
    log_prices = np.log(pool.price.to_numpy())
    summarized = pool.assign(lp=log_prices, lppm=np.log(pool.price / pool.floor_size))
    tables = {}
    for key in SUMMARY_KEYS:
        tables[key] = summarized.groupby(key).agg(
            lp=("lp", "median"), n=("lp", "size"), spread=("lp", "std"),
            lppm=("lppm", "median"), area=("floor_size", "median"), rates=("rates", "median"))
    return dict(pool=pool, log_prices=log_prices, global_log_price=float(np.median(log_prices)),
                numeric=numeric_coordinates(pool), tables=tables,
                indices={key: pool.groupby(key).indices for key in ["province", "city_key", "suburb_key"]})


def aggregate_features(query, reference):
    query = summary_keys(query.reset_index(drop=True))
    output = pd.DataFrame(index=query.index)
    parent = np.full(len(query), reference["global_log_price"])
    for key in SUMMARY_KEYS:
        table = reference["tables"][key].reindex(query[key]).reset_index(drop=True)
        count = table.n.fillna(0)
        local = table.lp.fillna(pd.Series(parent))
        estimate = (count * local + SHRINKAGE * parent) / (count + SHRINKAGE)
        output[key + "_logmedian"] = estimate
        output[key + "_count"] = count
        output[key + "_dispersion"] = table.spread
        output[key + "_logppm"] = table.lppm
        output[key + "_typical_area"] = table.area
        output[key + "_typical_rates"] = table.rates
        # The final three structural groups all shrink toward the subject's suburb.
        if key in ["province", "city_key", "suburb_key"]:
            parent = estimate.to_numpy()
    return output


def prediction_features(query, reference):
    return pd.concat([structural_features(query), aggregate_features(query, reference),
                      comparable_features(query, reference)], axis=1)[FEATURE_COLUMNS]


def training_features(training):
    """Each row's price and linked group are absent from its historical evidence."""
    training = training.reset_index(drop=True)
    if training.group.nunique() < INNER_FOLDS:
        raise ValueError(f"Training requires at least {INNER_FOLDS} distinct property groups.")
    splitter = GroupKFold(n_splits=INNER_FOLDS, shuffle=True, random_state=INNER_SEED)
    held_features = []
    for fit_indices, held_indices in splitter.split(training, groups=training.group):
        reference = build_reference(training.iloc[fit_indices])
        held = training.iloc[held_indices]
        features = pd.concat([aggregate_features(held, reference), comparable_features(held, reference)], axis=1)
        features.index = held_indices
        held_features.append(features)
    return pd.concat([structural_features(training), pd.concat(held_features).sort_index()], axis=1)[FEATURE_COLUMNS]

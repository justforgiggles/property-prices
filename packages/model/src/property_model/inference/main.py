"""Saved artifacts + validated property inputs → asking price and diagnostics."""
import argparse
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from ..artifacts import load_model
from ..comparables import comparable_features
from ..config import BRANCH_WEIGHT, CATEGORICAL, EXAMPLE, LIMITS, MULTIPLIER, NUMERIC, PACKAGE
from ..features import add_geography, categorical_frame, normalize, prediction_features


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", default=PACKAGE / "models")
    parser.add_argument("--input", help="Property JSON, batch JSON, or a JSON file; defaults to the documented example.")
    args = parser.parse_args(argv)
    try:
        records = EXAMPLE
        if args.input is not None:
            raw = args.input if args.input.lstrip().startswith(("{", "[")) else Path(args.input).read_text()
            records = json.loads(raw)
        print(json.dumps(predict(records, load_model(args.model_dir)), indent=2, allow_nan=False))
    except (OSError, ValueError, TypeError) as error:
        parser.exit(1, f"Prediction failed: {error}\n")


def predict(records, model=None):
    """Validate one property or a batch and return the existing diagnostic contract."""
    query = inputs_frame(records)
    if model is None:
        model = get_model()
    return predict_frame(model, query, details=True)


@lru_cache(maxsize=1)
def get_model(directory=PACKAGE / "models"):
    return load_model(directory)


def predict_frame(model, query, details=False):
    features = prediction_features(query, model.reference)
    for column in CATEGORICAL:
        features[column] = features[column].fillna("__unknown__").astype(str)
    direct_features = categorical_frame(features, model.categories)
    predictions = [np.exp(np.clip(learner.predict(direct_features, num_threads=4), 0, 25))
                   for learner in model.direct]
    correction = model.residual.predict(features) + model.residual_center
    predictions.append(np.exp(np.clip(correction + features.comp_log, 0, 25)))
    predictions = np.asarray(predictions)

    # Preserve the production override without changing historical training features.
    empty = query[NUMERIC].isna().all(axis=1).to_numpy()
    metadata = comparable_features(query, model.reference, safe_empty=True) if details or empty.any() else None
    if empty.any():
        predictions[:, empty] = np.exp(metadata.comp_log.to_numpy()[empty])
    weights = np.array([BRANCH_WEIGHT / len(model.direct)] * len(model.direct) + [BRANCH_WEIGHT])
    prices = np.average(predictions, axis=0, weights=weights) * MULTIPLIER
    if not details:
        return prices

    return prediction_results(query, prices, predictions, metadata, empty)


def prediction_results(query, prices, predictions, metadata, empty):
    output = []
    for index, price in enumerate(prices):
        comparable = metadata.iloc[index]
        output.append(dict(
            recommended_asking_price_zar=round(float(price), -3),
            unrounded_prediction_zar=float(price),
            comparable_count=int(comparable.comp_count),
            historical_suburb_count=int(comparable.comp_suburb_key_n),
            historical_city_count=int(comparable.comp_city_key_n),
            historical_province_count=int(comparable.comp_province_n),
            comparable_estimate_zar=float(np.exp(comparable.comp_log)),
            closest_comparable_distance=nullable(comparable.comp_closest),
            mean_comparable_distance=nullable(comparable.comp_distance),
            comparable_price_per_m2_zar=nullable(np.exp(comparable.comp_logppm)),
            geographic_fallback=["suburb", "city", "province", "global"][int(comparable.comp_fallback)],
            comparable_log_dispersion=float(comparable.comp_dispersion),
            model_log_std=None if empty[index] else float(np.std(np.log(predictions[:, index]))),
            missing_inputs=[column for column in NUMERIC if pd.isna(query.iloc[index][column])],
        ))
    return output


def nullable(value):
    return None if pd.isna(value) else float(value)


def inputs_frame(records):
    """Validate the public seven-input contract; unknown measurements stay missing."""
    if isinstance(records, dict):
        records = [records]
    if not isinstance(records, list) or not records:
        raise ValueError("Supply a property object or non-empty list of objects.")
    rows = []
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Each property must be an object.")
        extra = set(record) - {"province", "city", "suburb", *NUMERIC}
        if extra:
            raise ValueError(f"Unexpected fields: {sorted(extra)}")
        row = {}
        for column in ["province", "city", "suburb"]:
            value = record.get(column)
            if value is not None and not isinstance(value, str):
                raise ValueError(f"{column} must be text or null")
            row[column] = normalize(value)
        for column, (low, high) in LIMITS.items():
            value = record.get(column)
            if value is None:
                row[column] = np.nan
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value):
                raise ValueError(f"{column} must be a finite number or null")
            if not low <= value <= high:
                raise ValueError(f"{column} must be between {low} and {high}; use null if unknown")
            row[column] = float(value)
        rows.append(row)
    return add_geography(pd.DataFrame(rows))


if __name__ == "__main__":
    main()

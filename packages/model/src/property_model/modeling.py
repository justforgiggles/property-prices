"""The final ten-direct-plus-one-residual ensemble, with no experimental branches."""
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from lightgbm import LGBMRegressor

from .comparables import comparable_features
from .config import (BRANCH_WEIGHT, CATBOOST_PARAMS, CATEGORICAL, LIGHTGBM_PARAMS,
                     MULTIPLIER, NUMERIC, SEEDS)
from .data import inputs_frame
from .features import build_reference, prediction_features, training_features


def categorical_frame(features, categories):
    frame = features.copy()
    for column, levels in categories.items():
        frame[column] = pd.Categorical(frame[column].fillna("__unknown__").astype(str).where(frame[column].isin(levels)), categories=levels)
    return frame


@dataclass
class AskingPriceModel:
    """In-memory package; persistence stores native learners and plain reference data."""
    direct: list
    residual: CatBoostRegressor
    categories: dict
    residual_center: float
    reference: dict

    def predict_frame(self, query, details=False):
        features = prediction_features(query, self.reference)
        for column in CATEGORICAL:
            features[column] = features[column].fillna("__unknown__").astype(str)
        direct_features = categorical_frame(features, self.categories)
        predictions = [np.exp(np.clip(learner.predict(direct_features, num_threads=4), 0, 25))
                       for learner in self.direct]
        correction = self.residual.predict(features) + self.residual_center
        predictions.append(np.exp(np.clip(correction + features.comp_log, 0, 25)))
        predictions = np.asarray(predictions)

        # Preserve the production override without changing historical training features.
        empty = query[NUMERIC].isna().all(axis=1).to_numpy()
        metadata = comparable_features(query, self.reference, safe_empty=True) if details or empty.any() else None
        if empty.any():
            predictions[:, empty] = np.exp(metadata.comp_log.to_numpy()[empty])
        weights = np.array([BRANCH_WEIGHT / len(self.direct)] * len(self.direct) + [BRANCH_WEIGHT])
        prices = np.average(predictions, axis=0, weights=weights) * MULTIPLIER
        if not details:
            return prices

        def nullable(value):
            return None if pd.isna(value) else float(value)

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

    def predict(self, records):
        return self.predict_frame(inputs_frame(records), details=True)


def fit_model(training):
    """Cross-fit features once, fit the frozen learners, then retain full-data references."""
    print("Building grouped training features...", file=sys.stderr, flush=True)
    features = training_features(training)
    for column in CATEGORICAL:
        features[column] = features[column].fillna("__unknown__").astype(str)
    categories = {column: sorted(features[column].unique()) for column in CATEGORICAL}
    direct_features = categorical_frame(features, categories)
    log_prices = np.log(training.price.to_numpy())

    def fit_direct(seed):
        learner = LGBMRegressor(**LIGHTGBM_PARAMS, random_state=seed)
        learner.fit(direct_features, log_prices)
        print(f"Fitted LightGBM seed {seed}", file=sys.stderr, flush=True)
        return learner.booster_

    with ThreadPoolExecutor(max_workers=2) as executor:
        direct = list(executor.map(fit_direct, SEEDS))
    targets = log_prices - features.comp_log
    center = float(np.median(targets))
    residual = CatBoostRegressor(**CATBOOST_PARAMS)
    residual.fit(features, targets - center, cat_features=CATEGORICAL)
    print("Fitted CatBoost residual learner", file=sys.stderr, flush=True)
    return AskingPriceModel(direct, residual, categories, center, build_reference(training))

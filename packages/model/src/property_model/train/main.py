"""Raw listings → production training → artifacts and form locations."""
import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor
from lightgbm import LGBMRegressor
from sklearn.model_selection import GroupKFold

from ..artifacts import ModelArtifacts, save_model
from ..comparables import comparable_features
from ..config import (CATBOOST_PARAMS, CATEGORICAL, FEATURE_COLUMNS, INNER_FOLDS,
                      INNER_SEED, LIGHTGBM_PARAMS, PACKAGE, ROOT, SEEDS)
from ..features import aggregate_features, build_reference, categorical_frame, structural_features
from .data import clean_listings, property_groups, read_listings
from .locations import prepare_location_updates


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data/raw")
    parser.add_argument("--output-dir", type=Path, default=PACKAGE / "models")
    args = parser.parse_args(argv)
    try:
        train(args.data_dir, args.output_dir)
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Training failed: {error}\n")


def train(data_directory, output_directory):
    raw_listings, source_audit, labels = read_listings(data_directory)
    listings, cleaning_audit = clean_listings(raw_listings)
    listings["group"] = property_groups(listings)
    audit = {**source_audit, **cleaning_audit, "groups": int(listings.group.nunique())}

    location_updates = prepare_location_updates(listings, labels, PACKAGE / "locations.json", ROOT / "forms/property-valuation.yaml")
    print(f"Cleaned {len(listings):,} listings in {audit['groups']:,} property groups.", flush=True)

    production_features = build_training_features(listings)
    production_model = fit_models(listings, production_features)
    metadata = dict(data_audit=audit, population="all_valid",
                    training_rows=len(listings), training_groups=audit["groups"],
                    training_ids=listings.id.tolist())
    save_model(production_model, output_directory, metadata, location_updates)
    print(f"Saved model to {output_directory} and updated local form locations.", flush=True)


def build_training_features(training):
    """Each row's price and linked group are absent from its historical evidence."""
    training = training.reset_index(drop=True)
    if training.group.nunique() < INNER_FOLDS:
        raise ValueError(f"Training requires at least {INNER_FOLDS} distinct property groups.")
    splitter = GroupKFold(n_splits=INNER_FOLDS, shuffle=True, random_state=INNER_SEED)
    held_features = []
    for fit_indices, held_indices in splitter.split(training, groups=training.group):
        reference = build_reference(training.iloc[fit_indices])
        held = training.iloc[held_indices]
        summaries = aggregate_features(held, reference)
        comparables = comparable_features(held, reference)
        features = pd.concat([summaries, comparables], axis=1)
        features.index = held_indices
        held_features.append(features)
    structural = structural_features(training)
    historical = pd.concat(held_features).sort_index()
    return pd.concat([structural, historical], axis=1)[FEATURE_COLUMNS]


def fit_models(training, features):
    """Fit ten log-price learners and one comparable-residual learner from the same inputs."""
    features = features.copy()
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
    return ModelArtifacts(direct, residual, categories, center, build_reference(training))


if __name__ == "__main__":
    main()

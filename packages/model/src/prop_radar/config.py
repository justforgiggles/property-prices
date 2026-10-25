"""The frozen model recipe. Changes here create a new model version."""
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[2]
ROOT = PACKAGE.parents[1]
NUMERIC = ["bedrooms", "bathrooms", "floor_size", "rates"]
LOCATIONS = ["province", "city", "suburb", "city_key", "suburb_key"]
CATEGORICAL = LOCATIONS + ["size_band"]
LIMITS = {"bedrooms": (0, 100), "bathrooms": (0, 100),
          "floor_size": (5, 100000), "rates": (0, 1000000)}
SIZE_EDGES = [0, 50, 100, 150, 250, 400, 800, float("inf")]
SUMMARY_KEYS = ["province", "city_key", "suburb_key", "bed_key", "config_key", "size_key"]
SUMMARY_SUFFIXES = ["logmedian", "count", "dispersion", "logppm", "typical_area", "typical_rates"]
RATIOS = [("bathrooms", "bedrooms"), ("floor_size", "bedrooms"),
          ("floor_size", "bathrooms"), ("rates", "floor_size"), ("rates", "bedrooms")]
COMPARABLE_COLUMNS = ["comp_log", "comp_count", "comp_closest", "comp_distance",
                      "comp_dispersion", "comp_logppm", "comp_fallback",
                      "comp_province_n", "comp_city_key_n", "comp_suburb_key_n"]
FEATURE_COLUMNS = (
    LOCATIONS + NUMERIC
    + [name for column in NUMERIC for name in (column + "_missing", "log_" + column)]
    + [a + "_per_" + b for a, b in RATIOS] + ["rooms_product", "size_band"]
    + [key + "_" + suffix for key in SUMMARY_KEYS for suffix in SUMMARY_SUFFIXES]
    + COMPARABLE_COLUMNS
)
SEEDS = [7, 19, 41, 67, 101, 137, 211, 307, 419, 523]
INNER_FOLDS = 4
INNER_SEED = 119
COMPARABLE_COUNT = 5
AREA_POWER = 0.5
RATE_WEIGHT = 1.5
SHRINKAGE = 10
MULTIPLIER = 0.98
BRANCH_WEIGHT = 0.5
LIGHTGBM_PARAMS = dict(n_estimators=2200, learning_rate=0.04, num_leaves=63,
                       min_child_samples=30, reg_lambda=40.0, colsample_bytree=0.8,
                       objective="regression_l1", n_jobs=4, verbosity=-1)
CATBOOST_PARAMS = dict(iterations=3000, depth=6, learning_rate=0.025, l2_leaf_reg=8.0,
                      random_strength=1.0, border_count=128, max_ctr_complexity=2,
                      bootstrap_type="Bayesian", bagging_temperature=0.5,
                      loss_function="Huber:delta=0.3", thread_count=4, verbose=False,
                      allow_writing_files=False, random_seed=41)
EXAMPLE = dict(province="Gauteng", city="Johannesburg", suburb="Berea",
               bedrooms=2, bathrooms=1, floor_size=85, rates=700)


def recipe():
    """JSON-safe settings recorded with every model package."""
    return dict(lightgbm=LIGHTGBM_PARAMS, seeds=SEEDS, catboost=CATBOOST_PARAMS,
                inner_folds=INNER_FOLDS, inner_seed=INNER_SEED,
                comparable_count=COMPARABLE_COUNT, area_power=AREA_POWER,
                rate_weight=RATE_WEIGHT, shrinkage=SHRINKAGE,
                branch_weight=BRANCH_WEIGHT, multiplier=MULTIPLIER,
                features=FEATURE_COLUMNS)

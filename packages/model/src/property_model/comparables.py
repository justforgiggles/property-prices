"""Five comparable listings: geographic fallback, similarity and area-adjusted price."""
import numpy as np
import pandas as pd

from .config import AREA_POWER, COMPARABLE_COLUMNS, COMPARABLE_COUNT, RATE_WEIGHT


def comparable_features(query, reference, safe_empty=False):
    """Build comparable evidence; inference may use market medians for empty inputs."""
    query = query.reset_index(drop=True)
    coordinates = numeric_coordinates(query)
    rows = []
    for index, subject in query.iterrows():
        pool, fallback = select_comparable_pool(subject, reference)
        subject_coordinates = coordinates[index]
        if safe_empty and not np.isfinite(subject_coordinates).any():
            estimate = estimate_market_median(reference, pool)
        else:
            distances = calculate_comparable_distances(subject_coordinates, reference["numeric"][pool])
            nearest = np.argsort(distances, kind="stable")[:COMPARABLE_COUNT]
            selected = pool[nearest]
            estimate = estimate_price_from_comparables(subject_coordinates, reference, selected, distances[nearest])
        estimate["comp_fallback"] = fallback
        for key, groups in reference["indices"].items():
            estimate[f"comp_{key}_n"] = len(groups.get(subject[key], []))
        rows.append(estimate)
    return pd.DataFrame(rows, columns=COMPARABLE_COLUMNS)


def numeric_coordinates(frame):
    return np.column_stack([frame.bedrooms / 2, frame.bathrooms / 2,
                            np.log(frame.floor_size), np.log1p(frame.rates)])


def select_comparable_pool(subject, reference):
    """Choose the most local population with five listings, otherwise use all listings."""
    for level, key in enumerate(["suburb_key", "city_key", "province"]):
        candidates = reference["indices"][key].get(subject[key], [])
        if len(candidates) >= COMPARABLE_COUNT:
            return np.asarray(candidates), level
    return np.arange(len(reference["log_prices"])), 3


def calculate_comparable_distances(subject, candidates):
    """Weighted shared-measurement distance plus a penalty for missing comparisons."""
    weights = np.array([1.0, 1.0, 2.0, RATE_WEIGHT])
    shared = np.isfinite(candidates) & np.isfinite(subject)
    differences = np.where(shared, np.abs(candidates - subject), 0.0)
    weighted_difference = np.sum(differences * weights, axis=1)
    shared_weight = np.maximum((shared * weights).sum(axis=1), 0.1)
    missing_penalty = 0.25 * (1 - shared.mean(axis=1))
    return weighted_difference / shared_weight + missing_penalty


def estimate_price_from_comparables(subject, reference, selected, distances):
    """Area-adjust neighbors, then take their distance-weighted median log price."""
    historical = reference["numeric"]
    log_prices = reference["log_prices"]
    contributions = np.exp(-3 * distances)
    adjusted_prices = log_prices[selected].copy()
    area_delta = subject[2] - historical[selected, 2]
    area_adjustment = np.where(np.isfinite(area_delta), np.clip(area_delta, -0.7, 0.7), 0)
    adjusted_prices += AREA_POWER * area_adjustment
    order = np.argsort(adjusted_prices)
    cumulative_weight = np.cumsum(contributions[order])
    middle = np.searchsorted(cumulative_weight, contributions.sum() / 2)
    estimate = adjusted_prices[order][middle]
    log_ppm = log_prices[selected] - historical[selected, 2]
    dispersion = np.sqrt(np.average((adjusted_prices - estimate) ** 2, weights=contributions))
    return dict(
        comp_log=estimate, comp_count=len(selected),
        comp_closest=float(distances.min()),
        comp_distance=float(np.average(distances, weights=contributions)),
        comp_dispersion=float(dispersion),
        comp_logppm=float(np.nanmedian(log_ppm)) if np.isfinite(historical[selected, 2]).any() else np.nan,
    )


def estimate_market_median(reference, pool):
    """An inference-only fallback when every numeric property input is missing."""
    prices = reference["log_prices"][pool]
    log_ppm = prices - reference["numeric"][pool, 2]
    return dict(
        comp_log=float(np.median(prices)), comp_count=0,
        comp_closest=np.nan, comp_distance=np.nan,
        comp_dispersion=float(np.std(prices)),
        comp_logppm=float(np.nanmedian(log_ppm)) if np.isfinite(log_ppm).any() else np.nan,
    )

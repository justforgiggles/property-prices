"""Five-neighbor comparable valuation and geographic fallback."""
import numpy as np
import pandas as pd

from .config import AREA_POWER, COMPARABLE_COLUMNS, COMPARABLE_COUNT, RATE_WEIGHT


def numeric_coordinates(frame):
    return np.column_stack([frame.bedrooms / 2, frame.bathrooms / 2,
                            np.log(frame.floor_size), np.log1p(frame.rates)])


def comparable_features(query, reference, safe_empty=False):
    """Training uses ordinary neighbors; inference can override all-missing subjects."""
    query = query.reset_index(drop=True)
    subjects = numeric_coordinates(query)
    weights = np.array([1.0, 1.0, 2.0, RATE_WEIGHT])
    historical = reference["numeric"]
    log_prices = reference["log_prices"]
    rows = []
    for index, subject in query.iterrows():
        counts = {key: len(groups.get(subject[key], []))
                  for key, groups in reference["indices"].items()}
        pool = np.arange(len(log_prices))
        fallback = 3
        for level, key in enumerate(["suburb_key", "city_key", "province"]):
            candidates = reference["indices"][key].get(subject[key], [])
            if len(candidates) >= COMPARABLE_COUNT:
                pool = np.asarray(candidates)
                fallback = level
                break

        if safe_empty and not np.isfinite(subjects[index]).any():
            prices = log_prices[pool]
            log_ppm = prices - historical[pool, 2]
            rows.append(dict(
                comp_log=float(np.median(prices)), comp_count=0,
                comp_closest=np.nan, comp_distance=np.nan,
                comp_dispersion=float(np.std(prices)),
                comp_logppm=float(np.nanmedian(log_ppm)) if np.isfinite(log_ppm).any() else np.nan,
                comp_fallback=fallback,
                **{f"comp_{key}_n": count for key, count in counts.items()},
            ))
            continue

        # ponytail: scan the selected pool; add a neighbor index only if measured request latency requires it.
        candidates = historical[pool]
        shared = np.isfinite(candidates) & np.isfinite(subjects[index])
        differences = np.where(shared, np.abs(candidates - subjects[index]), 0.0)
        distance = (np.sum(differences * weights, axis=1)
                    / np.maximum((shared * weights).sum(axis=1), 0.1)
                    + 0.25 * (1 - shared.mean(axis=1)))
        nearest = np.argsort(distance, kind="stable")[:COMPARABLE_COUNT]
        selected = pool[nearest]
        distances = distance[nearest]
        contributions = np.exp(-3 * distances)
        adjusted_prices = log_prices[selected].copy()
        area_delta = subjects[index, 2] - historical[selected, 2]
        adjusted_prices += AREA_POWER * np.where(np.isfinite(area_delta), np.clip(area_delta, -0.7, 0.7), 0)
        order = np.argsort(adjusted_prices)
        middle = np.searchsorted(np.cumsum(contributions[order]), contributions.sum() / 2)
        estimate = adjusted_prices[order][middle]
        log_ppm = log_prices[selected] - historical[selected, 2]
        rows.append(dict(
            comp_log=estimate, comp_count=len(selected),
            comp_closest=float(distances.min()),
            comp_distance=float(np.average(distances, weights=contributions)),
            comp_dispersion=float(np.sqrt(np.average((adjusted_prices - estimate) ** 2, weights=contributions))),
            comp_logppm=float(np.nanmedian(log_ppm)) if np.isfinite(historical[selected, 2]).any() else np.nan,
            comp_fallback=fallback,
            **{f"comp_{key}_n": count for key, count in counts.items()},
        ))
    return pd.DataFrame(rows, columns=COMPARABLE_COLUMNS)

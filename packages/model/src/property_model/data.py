"""Validate and normalize raw dated JSON-LD for model training."""

from __future__ import annotations

from collections import Counter
import json
import math
from pathlib import Path

import pandas as pd

REQUIRED_CATEGORIES = ("country", "region", "locality_1", "locality_2", "type")
SUPPORTED_REGIONS = {"Gauteng", "Western Cape", "KwaZulu Natal"}
SUPPORTED_TYPES = {"House", "Apartment / Flat", "Townhouse"}
MIN_PRICE = 50_000
MAX_PRICE = 200_000_000
MIN_PRICE_PER_SQM = 500
MAX_PRICE_PER_SQM = 500_000


def _number(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.replace(",", ""))
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) and number > 0 else None


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _is_rental(node: dict, elements: list) -> bool:
    values = [node.get("url")]
    offers = node.get("offers")
    if isinstance(offers, dict):
        values.append(offers.get("url"))
    for element in elements:
        if isinstance(element, dict):
            values.extend((element.get("name"), element.get("item")))
    texts = [value.strip().lower() for value in values if isinstance(value, str)]
    return any("/to-rent/" in value or "/for-rent/" in value for value in texts) or any(
        value in {"property to rent", "property for rent"} for value in texts
    )


def _missing_or_invalid(value: object, field: str) -> str:
    return f"missing_{field}" if value is None or value == "" else f"invalid_{field}"


def _normalize_raw(raw: object) -> tuple[dict | None, str | None, str | None]:
    if not isinstance(raw, dict) or not isinstance(raw.get("jsonld"), list):
        raise ValueError("Raw listing must contain {id, jsonld}")
    if not isinstance(raw.get("id"), int) or isinstance(raw["id"], bool):
        raise ValueError("Raw listing ID must be an integer")

    reasons: list[str] = []
    observed_date = None
    for document in raw["jsonld"]:
        if not isinstance(document, dict) or not isinstance(document.get("@graph"), list):
            continue
        for node in document["@graph"]:
            if not isinstance(node, dict) or not isinstance(node.get("about"), dict) or not isinstance(node.get("offers"), dict):
                continue
            about = node["about"]
            address = about.get("address") if isinstance(about.get("address"), dict) else {}
            offers = node["offers"]
            specification = offers.get("priceSpecification") if isinstance(offers.get("priceSpecification"), dict) else {}
            breadcrumb = node.get("breadcrumb") if isinstance(node.get("breadcrumb"), dict) else {}
            elements = breadcrumb.get("itemListElement") if isinstance(breadcrumb.get("itemListElement"), list) else []
            date_posted = _text(node.get("datePosted"))
            observed_date = observed_date or date_posted

            if _is_rental(node, elements):
                reasons.append("rental_listing")
                continue

            record = {
                "id": raw["id"],
                "date_posted": date_posted,
                "country": _text(address.get("addressCountry")),
                "region": _text(address.get("addressRegion")),
                "locality_1": _text(elements[2].get("name")) if len(elements) > 2 and isinstance(elements[2], dict) else None,
                "locality_2": _text(address.get("addressLocality")),
                "type": _text(about.get("description", about.get("@type"))),
            }
            missing_category = next((field for field in REQUIRED_CATEGORIES if record[field] is None), None)
            if date_posted is None:
                reasons.append("missing_date_posted")
                continue
            if missing_category:
                reasons.append(f"missing_{missing_category}")
                continue
            if record["region"] not in SUPPORTED_REGIONS:
                reasons.append("unsupported_region")
                continue
            if record["type"] not in SUPPORTED_TYPES:
                reasons.append("unsupported_type")
                continue

            raw_bathrooms = about.get("numberOfBathroomsTotal")
            if raw_bathrooms is None:
                raw_bathrooms = about.get("numberOfBathrooms")
            for field, raw_value in (
                ("bedrooms", about.get("numberOfBedrooms")),
                ("bathrooms", raw_bathrooms),
            ):
                if raw_value is None or raw_value == "":
                    record[field] = None
                    continue
                value = _number(raw_value)
                if value is None or not value.is_integer() or not 1 <= value <= 20:
                    reasons.append(f"invalid_{field}")
                    break
                record[field] = int(value)
            else:
                raw_floor_size = about.get("floorSize")
                if raw_floor_size is None or isinstance(raw_floor_size, dict) and raw_floor_size.get("value") in (None, ""):
                    record["size"] = None
                elif not isinstance(raw_floor_size, dict):
                    reasons.append("invalid_size")
                    continue
                else:
                    size = _number(raw_floor_size.get("value"))
                    if size is None or not 10 <= size <= 5_000:
                        reasons.append("invalid_size")
                        continue
                    record["size"] = size

                if specification.get("priceCurrency") != "ZAR":
                    reasons.append("non_zar_price")
                    continue
                raw_price = specification.get("price")
                price = _number(raw_price)
                if price is None or not MIN_PRICE <= price <= MAX_PRICE:
                    reasons.append(_missing_or_invalid(raw_price, "price"))
                    continue
                if record["size"] is not None and not MIN_PRICE_PER_SQM <= price / record["size"] <= MAX_PRICE_PER_SQM:
                    reasons.append("invalid_price_per_sqm")
                    continue
                record["price"] = price
                return record, None, date_posted

    return None, reasons[0] if reasons else "missing_listing_node", observed_date


def normalize_raw(raw: object) -> dict | None:
    """Return a supported sale listing, including rows whose floor size is missing."""
    return _normalize_raw(raw)[0]


def load_data(
    directory: Path, minimum_rows: int = 20, *, return_report: bool = False
) -> pd.DataFrame | tuple[pd.DataFrame, dict[str, object]]:
    """Load dated raw files, optionally returning inclusion/exclusion counts."""
    if not directory.is_dir():
        raise FileNotFoundError(f"Raw data directory not found: {directory}")
    records = []
    ids = set()
    exclusions: Counter[str] = Counter()
    total = 0
    for path in sorted(directory.glob("????-??-??.jsonl")):
        with path.open("r", encoding="utf-8") as source:
            for number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                total += 1
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"Invalid JSON in {path.name}:{number}") from error
                if not isinstance(raw, dict) or not isinstance(raw.get("id"), int) or isinstance(raw["id"], bool):
                    raise ValueError(f"Invalid raw listing ID in {path.name}:{number}")
                if raw["id"] in ids:
                    raise ValueError(f"Duplicate raw listing ID {raw['id']}")
                ids.add(raw["id"])
                record, reason, date_posted = _normalize_raw(raw)
                if date_posted is not None and date_posted != path.stem:
                    raise ValueError(
                        f"datePosted {date_posted!r} does not match {path.name} in line {number}"
                    )
                if record is not None:
                    records.append(record)
                else:
                    exclusions[reason or "unknown"] += 1
    if len(records) < minimum_rows:
        raise ValueError(f"Expected at least {minimum_rows} usable listings, found {len(records)}")
    data = pd.DataFrame.from_records(records)
    if not return_report:
        return data
    missing_size = int(data["size"].isna().sum())
    missing_rooms = int(data[["bedrooms", "bathrooms"]].isna().any(axis=1).sum())
    return data, {
        "total": total,
        "included": len(records),
        "included_complete": len(records) - missing_size,
        "included_missing_size": missing_size,
        "included_missing_rooms": missing_rooms,
        "excluded": dict(sorted(exclusions.items())),
    }

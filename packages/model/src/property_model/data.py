"""Validate and normalize raw dated JSON-LD for model training."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pandas as pd

REQUIRED_CATEGORIES = ("country", "region", "locality_1", "locality_2", "type")
REQUIRED_NUMBERS = ("bedrooms", "bathrooms", "size", "price")


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


def normalize_raw(raw: object) -> dict | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("jsonld"), list):
        raise ValueError("Raw listing must contain {id, jsonld}")
    if not isinstance(raw.get("id"), int) or isinstance(raw["id"], bool):
        raise ValueError("Raw listing ID must be an integer")

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
            floor_size = about.get("floorSize") if isinstance(about.get("floorSize"), dict) else {}
            record = {
                "id": raw["id"],
                "country": address.get("addressCountry"),
                "region": address.get("addressRegion"),
                "locality_1": elements[2].get("name") if len(elements) > 2 and isinstance(elements[2], dict) else None,
                "locality_2": address.get("addressLocality"),
                "type": about.get("description", about.get("@type")),
                "bedrooms": _number(about.get("numberOfBedrooms")),
                "bathrooms": _number(about.get("numberOfBathroomsTotal", about.get("numberOfBathrooms"))),
                "size": _number(floor_size.get("value")),
                "price": _number(specification.get("price")) if specification.get("priceCurrency") == "ZAR" else None,
            }
            if all(isinstance(record[field], str) and record[field].strip() for field in REQUIRED_CATEGORIES) and all(record[field] is not None for field in REQUIRED_NUMBERS):
                return record
    return None


def load_data(directory: Path, minimum_rows: int = 20) -> pd.DataFrame:
    if not directory.is_dir():
        raise FileNotFoundError(f"Raw data directory not found: {directory}")
    records = []
    ids = set()
    for path in sorted(directory.glob("????-??-??.jsonl")):
        with path.open("r", encoding="utf-8") as source:
            for number, line in enumerate(source, start=1):
                if not line.strip():
                    continue
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"Invalid JSON in {path.name}:{number}") from error
                if not isinstance(raw, dict) or not isinstance(raw.get("id"), int) or isinstance(raw["id"], bool):
                    raise ValueError(f"Invalid raw listing ID in {path.name}:{number}")
                if raw["id"] in ids:
                    raise ValueError(f"Duplicate raw listing ID {raw['id']}")
                ids.add(raw["id"])
                record = normalize_raw(raw)
                if record is not None:
                    records.append(record)
    if len(records) < minimum_rows:
        raise ValueError(f"Expected at least {minimum_rows} complete listings, found {len(records)}")
    return pd.DataFrame.from_records(records)

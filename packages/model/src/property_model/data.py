"""Raw listing extraction, conservative cleaning and homeowner input validation."""
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from .config import LIMITS, NUMERIC


def normalize(value):
    return (re.sub(r"\s+", " ", str(value or "").strip().casefold())
            .replace("kwazulu-natal", "kwazulu natal") or "__unknown__")


def add_geography(frame):
    frame = frame.copy()
    frame["city_key"] = frame.province + "|" + frame.city
    frame["suburb_key"] = frame.city_key + "|" + frame.suburb
    return frame


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


def extract_listing(record, snapshot):
    listing = record["jsonld"][0]["@graph"][0]
    property_ = listing["about"]
    address = property_["address"]
    breadcrumb = {item["position"]: item["name"]
                  for item in listing["breadcrumb"]["itemListElement"]}
    return dict(
        id=str(record["id"]), price=listing["offers"]["priceSpecification"]["price"],
        province=normalize(breadcrumb.get(2, address.get("addressRegion"))),
        city=normalize(breadcrumb.get(3)),
        suburb=normalize(breadcrumb.get(4, address.get("addressLocality"))),
        bedrooms=property_.get("numberOfBedrooms", record.get("bedrooms")),
        bathrooms=property_.get("numberOfBathroomsTotal", record.get("bathrooms")),
        floor_size=property_.get("floorSize", {}).get("value", record.get("size")),
        rates=record.get("ratesAndTaxes"), date=listing.get("datePosted"), snapshot=snapshot,
        kind=property_.get("@type"), property_type=property_.get("description"),
        street=normalize(address.get("streetAddress")), image=listing.get("image", ""),
        description=listing.get("description", ""),
    )


def property_groups(frame):
    """Link related listings without price, preserving the original union-root order."""
    parent = list(range(len(frame)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    seen = {}
    for index, row in frame.iterrows():
        geography = (row.province, row.city, row.suburb)
        keys = []
        if row.street != "__unknown__" and re.search(r"\d", row.street):
            keys.append(("street", geography, row.street))
        if row.image:
            keys.append(("image", row.image))
        if len(row.description) > 60:
            keys.append(("text", geography, normalize(row.description), str(row.bedrooms),
                         str(row.bathrooms), str(row.floor_size)))
        for key in keys:
            if key in seen:
                parent[find(index)] = find(seen[key])
            else:
                seen[key] = index
    return [find(index) for index in range(len(frame))]


def clean_listings(frame):
    frame = frame.copy()
    for column in ["price"] + NUMERIC:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    invalid_price = ~np.isfinite(frame.price) | (frame.price < 10000)
    rental = frame.description.fillna("").str.contains(
        r"\b(?:to let|to rent|for rent|available for rental)\b", case=False, regex=True)
    residential = frame.kind.isin(["Apartment", "House"]) | frame.property_type.fillna("").str.contains(
        "house|apartment|townhouse|flat", case=False)
    excluded = invalid_price | rental | ~residential
    cleaned = frame[~excluded].copy()
    corrections = {}
    for column, (low, high) in LIMITS.items():
        bad = cleaned[column].notna() & (
            ~np.isfinite(cleaned[column]) | (cleaned[column] < low) | (cleaned[column] > high))
        corrections[column] = int(bad.sum())
        cleaned.loc[bad, column] = np.nan
    repeated = int(cleaned.id.duplicated().sum())
    cleaned = cleaned.sort_values(["date", "snapshot"]).drop_duplicates("id", keep="last").reset_index(drop=True)
    if cleaned.empty:
        raise ValueError("No valid residential listings remain after cleaning.")
    cleaned["group"] = property_groups(cleaned)
    audit = dict(raw_rows=len(frame), excluded_rows=int(excluded.sum()), repeated_ids_removed=repeated,
                 valid_rows=len(cleaned), groups=int(cleaned.group.nunique()),
                 invalid_features_set_missing=corrections)
    return add_geography(cleaned), audit


def load_data(directory):
    """Read raw data directly; no research cache or precomputed clean pickle is needed."""
    files = sorted(Path(directory).glob("*.jsonl"))
    if not files:
        raise ValueError(f"No JSONL files found in {directory}")
    rows, malformed = [], []
    digest = hashlib.sha256()
    for file in files:
        digest.update(file.name.encode())
        for number, line in enumerate(file.read_text().splitlines(), 1):
            digest.update(line.encode())
            try:
                rows.append(extract_listing(json.loads(line), file.stem))
            except (KeyError, IndexError, ValueError, TypeError) as error:
                malformed.append(dict(file=file.name, line=number, error=str(error)))
    if not rows:
        raise ValueError("No extractable listings found.")
    cleaned, audit = clean_listings(pd.DataFrame(rows))
    audit.update(files=len(files), raw_sha256=digest.hexdigest(), malformed=malformed)
    return cleaned, audit


def split_data(frame, path):
    """Use the locked IDs; never silently create a different evaluation population."""
    membership = json.loads(Path(path).read_text())
    if set(membership["development"]) & set(membership["test"]):
        raise ValueError("Development and test IDs overlap.")
    known = set(membership["development"]) | set(membership["test"])
    if not set(frame.id) <= known:
        raise ValueError("The supplied split does not cover this dataset. Supply matching split IDs.")
    development = frame[frame.id.isin(membership["development"])].reset_index(drop=True)
    test = frame[frame.id.isin(membership["test"])].reset_index(drop=True)
    if development.empty or test.empty or set(development.group) & set(test.group):
        raise ValueError("Split is empty or contains overlapping property groups.")
    return development, test

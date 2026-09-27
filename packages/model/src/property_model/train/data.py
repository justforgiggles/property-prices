"""Read raw listings, clean residential observations and link related properties."""
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import LIMITS, NUMERIC
from ..features import normalize, add_geography


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
    audit = dict(raw_rows=len(frame), excluded_rows=int(excluded.sum()), repeated_ids_removed=repeated,
                 valid_rows=len(cleaned),
                 invalid_features_set_missing=corrections)
    return add_geography(cleaned), audit


def read_listings(directory):
    """Return extracted rows, source audit and display labels from one raw-data read."""
    files = sorted(Path(directory).glob("*.jsonl"))
    if not files:
        raise ValueError(f"No JSONL files found in {directory}")
    rows, malformed = [], []
    labels = {}
    digest = hashlib.sha256()
    for file in files:
        digest.update(file.name.encode())
        for number, line in enumerate(file.read_text().splitlines(), 1):
            digest.update(line.encode())
            try:
                record = json.loads(line)
                collect_location_labels(record, labels)
                rows.append(extract_listing(record, file.stem))
            except (KeyError, IndexError, ValueError, TypeError) as error:
                malformed.append(dict(file=file.name, line=number, error=str(error)))
    if not rows:
        raise ValueError("No extractable listings found.")
    labels.update({"gauteng": "Gauteng", "western cape": "Western Cape", "kwazulu natal": "KwaZulu Natal"})
    audit = dict(files=len(files), raw_sha256=digest.hexdigest(), malformed=malformed)
    return pd.DataFrame(rows), audit, labels


def collect_location_labels(record, labels):
    """Preserve the first breadcrumb spelling, even if the listing is later excluded."""
    try:
        listing = record["jsonld"][0]["@graph"][0]
        for item in listing["breadcrumb"]["itemListElement"]:
            if item["position"] in (2, 3, 4) and isinstance(item["name"], str):
                labels.setdefault(normalize(item["name"]), " ".join(item["name"].split()))
    except (KeyError, IndexError, TypeError, ValueError):
        pass

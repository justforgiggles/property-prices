"""Keep the valuation form's location choices aligned with model data."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from .data import load_data, normalize


Locations = dict[str, dict[str, list[str]]]
FIELDS_START = "      - id: city\n"
FIELDS_END = "    next: property\n"


def build_locations(data: pd.DataFrame, labels: dict[str, str]) -> Locations:
    locations: dict[str, dict[str, set[str]]] = {}
    for province, city, suburb in data[["province", "city", "suburb"]].itertuples(index=False, name=None):
        if province not in {"gauteng", "kwazulu natal", "western cape"} or "__unknown__" in (city, suburb):
            continue
        province, city, suburb = (labels.get(name, name) for name in (province, city, suburb))
        locations.setdefault(province, {}).setdefault(city, set()).add(suburb)
    return {
        province: {city: sorted(suburbs) for city, suburbs in sorted(cities.items())}
        for province, cities in sorted(locations.items())
    }


def location_labels(raw_directory: Path) -> dict[str, str]:
    """Keep source spelling for display; prediction normalizes only at the model boundary."""
    labels = {}
    for path in sorted(raw_directory.glob("*.jsonl")):
        for line in path.read_text().splitlines():
            try:
                listing = json.loads(line)["jsonld"][0]["@graph"][0]
                for item in listing["breadcrumb"]["itemListElement"]:
                    if item["position"] in (2, 3, 4) and isinstance(item["name"], str):
                        labels.setdefault(normalize(item["name"]), " ".join(item["name"].split()))
            except (KeyError, IndexError, TypeError, ValueError):
                continue
    labels.update({"gauteng": "Gauteng", "western cape": "Western Cape", "kwazulu natal": "KwaZulu Natal"})
    return labels


def _yaml(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_location_fields(locations: Locations) -> str:
    lines = [
        "      - id: city",
        "        type: dropdown",
        '        label: "City or town"',
        "        searchable: true",
        "        depends_on: province",
        "        options_by_parent:",
    ]
    for province, cities in locations.items():
        lines.append(f"          {_yaml(province)}:")
        lines.extend(f"            - {_yaml(city)}" for city in cities)
    lines.extend([
        "        validators:",
        "          - type: required",
        '            message: "Select a city or town."',
        "",
        "      - id: suburb",
        "        type: dropdown",
        '        label: "Suburb"',
        "        searchable: true",
        "        depends_on: city",
        "        options_by_parent:",
    ])

    city_provinces: dict[str, list[str]] = {}
    for province, cities in locations.items():
        for city in cities:
            city_provinces.setdefault(city, []).append(province)

    rendered: set[str] = set()
    for province, cities in locations.items():
        for city, suburbs in cities.items():
            if city in rendered:
                continue
            rendered.add(city)
            lines.append(f"          {_yaml(city)}:")
            provinces = city_provinces[city]
            if len(provinces) == 1:
                lines.extend(f"            - {_yaml(suburb)}" for suburb in suburbs)
                continue
            for duplicate_province in provinces:
                for suburb in locations[duplicate_province][city]:
                    lines.extend([
                        f"            - label: {_yaml(f'{suburb} ({duplicate_province})')}",
                        f"              value: {_yaml(suburb)}",
                    ])

    lines.extend([
        "        validators:",
        "          - type: required",
        '            message: "Select a suburb."',
        "",
    ])
    return "\n".join(lines)


def sync_locations(root: Path, *, check: bool = False) -> None:
    raw_directory = root / "data" / "raw"
    data, _ = load_data(raw_directory)
    locations = build_locations(data, location_labels(raw_directory))
    locations_path = root / "packages" / "model" / "locations.json"
    form_path = root / "forms" / "property-valuation.yaml"
    expected_locations = json.dumps(locations, ensure_ascii=False, indent=2) + "\n"
    form = form_path.read_text(encoding="utf-8")
    start = form.index(FIELDS_START)
    end = form.index(FIELDS_END, start)
    expected_form = form[:start] + render_location_fields(locations) + form[end:]

    stale = [
        str(path.relative_to(root))
        for path, expected in ((locations_path, expected_locations), (form_path, expected_form))
        if path.read_text(encoding="utf-8") != expected
    ]
    if check and stale:
        paths = ", ".join(stale)
        raise ValueError(
            f"Location catalogs are stale: {paths}; run npm run sync:locations"
        )
    if not check:
        locations_path.write_text(expected_locations, encoding="utf-8")
        form_path.write_text(expected_form, encoding="utf-8")

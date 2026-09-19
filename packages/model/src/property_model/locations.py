"""Keep the valuation form's location choices aligned with model data."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from .data import load_data


Locations = dict[str, dict[str, list[str]]]
FIELDS_START = "      - id: city\n"
FIELDS_END = "    next: property\n"


def build_locations(data: pd.DataFrame) -> Locations:
    locations: dict[str, dict[str, set[str]]] = {}
    columns = data[["region", "locality_1", "locality_2"]]
    for region, city, suburb in columns.itertuples(index=False, name=None):
        locations.setdefault(str(region), {}).setdefault(str(city), set()).add(str(suburb))
    return {
        province: {
            city: sorted(locations[province][city])
            for city in sorted(locations[province])
        }
        for province in sorted(locations)
    }


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
        "          - required",
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

    lines.extend(["        validators:", "          - required", ""])
    return "\n".join(lines)


def sync_locations(root: Path, *, check: bool = False) -> None:
    locations = build_locations(load_data(root / "data" / "raw"))
    locations_path = root / "packages" / "function" / "locations.json"
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

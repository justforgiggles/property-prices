"""Keep all valuation forms' location choices aligned with model data."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


Locations = dict[str, dict[str, list[str]]]
FIELDS_START = "      - id: city\n"
FIELDS_END = "    next: property\n"
FORM_VARIANTS = {
    "property-valuation.yaml": False,
    "property-valuation copy.yaml": False,
    "property-valuation-janique-kinnear.yaml": True,
    "property-valuation-vito-wiechmann.yaml": True,
}


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


def _yaml(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_location_fields(locations: Locations, agent_form: bool = False) -> str:
    lines = [
        "      - id: city",
        "        type: dropdown",
        f'        label: {_yaml("Which city or town?" if agent_form else "City or town")}',
    ]
    if agent_form:
        lines.append('        placeholder: "Select a city or town"')
    lines.extend([
        "        searchable: true",
        "        depends_on: province",
        "        options_by_parent:",
    ])
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
        f'        label: {_yaml("Which suburb?" if agent_form else "Suburb")}',
    ])
    if agent_form:
        lines.append('        placeholder: "Select a suburb"')
    lines.extend([
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
    ])
    # shortcut: dropdowns support one parent; validate ambiguous cities until multi-parent filtering exists.
    for city, provinces in city_provinces.items():
        if not agent_form or len(provinces) < 2:
            continue
        matches = " || ".join(
            f"(data.province === {_yaml(province)} && "
            f"{json.dumps(locations[province][city], ensure_ascii=False)}.includes(data.suburb))"
            for province in provinces
        )
        lines.extend([
            "          - type: expression",
            f"            expression: {_yaml(f'data.city !== {_yaml(city)} || {matches}')}",
            '            message: "Choose a suburb in your selected province."',
        ])
    lines.append("")
    return "\n".join(lines)


def prepare_location_updates(data, labels, locations_path, form_paths: dict[Path, bool]):
    """Render the catalog and forms without writing; publish only with a verified model."""
    locations = build_locations(data, labels)
    if not locations:
        raise ValueError("Training data contains no supported form locations.")
    catalog = json.dumps(locations, ensure_ascii=False, indent=2) + "\n"
    updates = {locations_path: catalog}
    for form_path, agent_form in form_paths.items():
        form = form_path.read_text(encoding="utf-8")
        start = form.index(FIELDS_START)
        end = form.index(FIELDS_END, start)
        updates[form_path] = form[:start] + render_location_fields(locations, agent_form) + form[end:]
    return updates

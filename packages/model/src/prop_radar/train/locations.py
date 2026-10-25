"""Build the form location catalog from the training population."""
import pandas as pd

Locations = dict[str, dict[str, list[str]]]


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

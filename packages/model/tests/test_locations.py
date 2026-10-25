"""The training population produces a sorted, supported location catalog."""
import unittest
import pandas as pd
from prop_radar.train.locations import build_locations


class LocationTests(unittest.TestCase):
    def test_catalog_filters_unknowns_and_keeps_provinces_separate(self):
        data = pd.DataFrame([
            ("gauteng", "shared", "north"),
            ("western cape", "shared", "south"),
            ("gauteng", "shared", "north"),
            ("gauteng", "shared", "__unknown__"),
            ("unsupported", "city", "suburb"),
        ], columns=["province", "city", "suburb"])
        self.assertEqual(build_locations(data, {"gauteng": "Gauteng", "shared": "Shared"}), {
            "Gauteng": {"Shared": ["north"]}, "western cape": {"Shared": ["south"]},
        })


if __name__ == "__main__":
    unittest.main()

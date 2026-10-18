"""Exercise generated form expressions using the same JavaScript semantics as frms."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from property_model.train.locations import FORM_VARIANTS, FIELDS_END, FIELDS_START, prepare_location_updates, render_location_fields

ROOT = Path(__file__).resolve().parents[3]


class LocationFormTests(unittest.TestCase):
    def check_membership(self, locations):
        rendered = render_location_fields(locations, agent_form=True)
        expressions = [json.loads(line.strip().removeprefix("expression: "))
                       for line in rendered.splitlines() if line.strip().startswith("expression: ")]
        cases = []
        for province, cities in locations.items():
            for city, suburbs in cities.items():
                candidates = {suburb for other in locations.values() for suburb in other.get(city, [])}
                for suburb in candidates:
                    cases.append({"data": {"province": province, "city": city, "suburb": suburb},
                                  "expected": suburb in suburbs})
        result = subprocess.run(["node", "-e", """
const { expressions, cases } = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const checks = expressions.map(expression => new Function('data', `return ${expression}`));
for (const { data, expected } of cases) {
  require('node:assert/strict').equal(checks.every(check => check(data)), expected, JSON.stringify(data));
}
"""], input=json.dumps({"expressions": expressions, "cases": cases}), text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_catalog_membership_and_stale_suburb_after_province_change(self):
        self.check_membership(json.loads((ROOT / "packages/model/locations.json").read_text()))

    def test_multiple_duplicate_cities_and_quoted_names(self):
        self.check_membership({
            "North": {"Shared": ["One", "Common"], 'Other "city"': ["O'Brien"], "Unique": ["Only"]},
            "South": {"Shared": ["Two", "Common"], 'Other "city"': ['Quoted "suburb"']},
        })

    def test_checked_in_fields_match_generator(self):
        locations = json.loads((ROOT / "packages/model/locations.json").read_text())
        self.assertEqual(set(FORM_VARIANTS), {path.name for path in (ROOT / "forms").glob("property-valuation*.yaml")})
        for filename, agent_form in FORM_VARIANTS.items():
            with self.subTest(form=filename):
                form = (ROOT / "forms" / filename).read_text()
                self.assertEqual(form[form.index(FIELDS_START):form.index(FIELDS_END)],
                                 render_location_fields(locations, agent_form))

    def test_preparation_updates_all_forms_and_preserves_agent_copy_without_writing(self):
        data = pd.DataFrame([
            {"province": "gauteng", "city": "shared", "suburb": "north"},
            {"province": "western cape", "city": "shared", "suburb": "south"},
        ])
        with tempfile.TemporaryDirectory() as directory:
            catalog = Path(directory) / "locations.json"
            original = Path(directory) / "original.yaml"
            agent = Path(directory) / "janique.yaml"
            vito = Path(directory) / "vito.yaml"
            for path, title in ((original, "Original"), (agent, "Janique Kinnear"), (vito, "Vito Wiechmann")):
                path.write_text(f'title: "{title}"\n{FIELDS_START}        stale: true\n{FIELDS_END}# keep consent and completion\n')
            before = {path: path.read_text() for path in (original, agent, vito)}
            updates = prepare_location_updates(data, {}, catalog, {original: False, agent: True, vito: True})
            self.assertEqual(set(updates), {catalog, original, agent, vito})
            self.assertEqual(json.loads(updates[catalog]), {
                "gauteng": {"shared": ["north"]}, "western cape": {"shared": ["south"]},
            })
            for path in (original, agent, vito):
                self.assertEqual(path.read_text(), before[path])
                self.assertTrue(updates[path].startswith(before[path].split(FIELDS_START)[0]))
                self.assertTrue(updates[path].endswith(FIELDS_END + "# keep consent and completion\n"))
                self.assertNotIn("stale:", updates[path])
            self.assertFalse(catalog.exists())
            self.assertNotIn("helper_text:", updates[original])
            self.assertNotIn("helper_text:", updates[agent])
            self.assertNotIn("type: expression", updates[original])
            self.assertIn("type: expression", updates[agent])
            self.assertIn("type: expression", updates[vito])


if __name__ == "__main__":
    unittest.main()

"""Exercise agent generation in temporary workspaces, with no network or submissions."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("generator", ROOT / "scripts/generate-agent-forms.py")
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


def parse_yaml(text):
    result = subprocess.run(["node", "--input-type=module", "-e",
                             "import {load} from 'js-yaml'; let text=''; for await(const chunk of process.stdin) text+=chunk; console.log(JSON.stringify(load(text)));"],
                            cwd=ROOT, input=text, text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class AgentFormTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        shutil.copytree(ROOT / "forms/agents", self.root / "forms/agents")
        shutil.copytree(ROOT / "forms/templates", self.root / "forms/templates")
        (self.root / "packages/model").mkdir(parents=True)
        shutil.copyfile(ROOT / "packages/model/locations.json", self.root / "packages/model/locations.json")

    def test_repeatable_generation_and_nonwriting_drift_check(self):
        changes = generator.generate(self.root)
        self.assertEqual(len(changes), 5 * len(list((self.root / "forms/agents").glob("*.json"))))
        before = {p: p.read_bytes() for p in (self.root / "forms").rglob("*") if p.is_file()}
        self.assertEqual(generator.generate(self.root), [])
        self.assertEqual(generator.generate(self.root, check=True), [])
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        stale = self.root / "forms/property-valuation-vito-wiechmann.yaml"
        stale.write_text(stale.read_text() + "# manual drift\n")
        self.assertEqual(generator.generate(self.root, check=True), [str(stale.relative_to(self.root))])
        self.assertTrue(stale.read_text().endswith("# manual drift\n"))

    def test_shared_content_and_agent_contact_details(self):
        forms = []
        for slug in ("janique-kinnear", "vito-wiechmann"):
            profile = generator.load_profile(self.root / f"forms/agents/{slug}.json")
            form = parse_yaml(generator.render_form(self.root, slug, profile))
            self.assertEqual(form["theme"]["logo"]["height"], profile["logo"]["height"])
            self.assertIn(f'wa.me/{profile["whatsapp"]}?text=', form["completion"][0]["button"]["url"])
            original = parse_yaml((ROOT / f"forms/property-valuation-{slug}.yaml").read_text())
            for key in ("sections", "connections", "authentication", "measurements"):
                self.assertEqual(form[key], original[key])
            forms.append(form)
        for key in ("connections", "authentication", "measurements"):
            self.assertEqual(forms[0][key], forms[1][key])
        self.assertEqual(forms[0]["sections"][:-1], forms[1]["sections"][:-1])
        self.assertEqual(forms[0]["sections"][-1]["fields"][:3], forms[1]["sections"][-1]["fields"][:3])

    def test_names_are_safely_quoted_and_long_names_fit_the_shared_layout(self):
        path = self.root / "forms/agents/janique-kinnear.json"
        profile = json.loads(path.read_text())
        profile.update(name='Zoë "O’Brien" & Alexandrina Montgomery-Smythe', short_name='Zoë "O’Brien"', office='Cape "West"')
        path.write_text(json.dumps(profile))
        generator.generate(self.root, "janique-kinnear")
        form = parse_yaml((self.root / "forms/property-valuation-janique-kinnear.yaml").read_text())
        self.assertEqual(form["title"], f'{profile["name"]} | {profile["agency"]}')
        self.assertIn(profile["short_name"], form["sections"][-1]["description"])
        svg = (self.root / "forms/assets/janique-kinnear-og.svg").read_text()
        self.assertIn('&quot;O’Brien&quot; &amp;', svg.replace('&apos;', '’'))
        self.assertIn('y="222"', svg)
        self.assertNotIn('@@', svg)

    def test_invalid_profiles_and_missing_photos_publish_nothing(self):
        path = self.root / "forms/agents/vito-wiechmann.json"
        original = json.loads(path.read_text())
        for changes in ({"whatsapp": 27736058190}, {"primary": "red"}, {"logo": {"source": "vito-wiechmann/logo.png", "height": 121}},
                        {"portrait": {"source": "missing.jpg"}}, {"portrait": {"source": "../assets/photo.jpg"}},
                        {"custom_copy": "override"}):
            with self.subTest(changes=changes):
                path.write_text(json.dumps({**original, **changes}))
                with self.assertRaises(ValueError):
                    generator.generate(self.root)
                self.assertFalse((self.root / "forms/assets").exists())

    def test_photo_too_small_fails_before_any_outputs_are_written(self):
        target = self.root / "forms/agents/vito-wiechmann/portrait.jpg"
        subprocess.run(["node", "--input-type=module", "-e",
                        "import sharp from 'sharp'; await sharp({create:{width:100,height:100,channels:3,background:'#fff'}}).jpeg().toFile(process.argv[1]);", str(target)],
                       cwd=ROOT, check=True)
        with self.assertRaises(subprocess.CalledProcessError):
            generator.generate(self.root)
        self.assertFalse((self.root / "forms/assets").exists())

    def test_new_profile_is_generated_and_discovered_without_registration_edits(self):
        profile = json.loads((self.root / "forms/agents/vito-wiechmann.json").read_text())
        profile.update(name="Alex Example", short_name="Alex", agency="Example Realty")
        (self.root / "forms/agents/alex-example.json").write_text(json.dumps(profile))
        self.assertEqual(len(generator.generate(self.root, "alex-example")), 5)
        from property_model.train.locations import form_variants
        self.assertTrue(form_variants(self.root)["property-valuation-alex-example.yaml"])
        self.assertFalse((self.root / "forms/property-valuation-vito-wiechmann.yaml").exists())


if __name__ == "__main__":
    unittest.main()

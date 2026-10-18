"""Generate agent forms and sharing artwork from local profiles and shared templates."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages/model/src"))
from property_model.train.locations import render_location_fields

ASSET_BASE = "https://raw.githubusercontent.com/justforgiggles/property-prices/main/forms/assets"


def https_url(value):
    if not isinstance(value, str) or any(char.isspace() for char in value):
        return False
    parsed = urlsplit(value)
    return parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password


def load_profile(path):
    profile = json.loads(path.read_text())
    required = {"name", "short_name", "agency", "whatsapp", "primary", "logo", "icon", "portrait", "privacy_url", "sources"}
    if not isinstance(profile, dict) or not required <= profile.keys() or profile.keys() - required - {"office", "notes"}:
        raise ValueError(f"{path.name}: missing or unknown profile fields")
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", path.stem):
        raise ValueError("Profile filename must be a lowercase hyphenated slug")
    for key in ("name", "short_name", "agency", "office"):
        value = profile.get(key, "")
        if not isinstance(value, str) or (key != "office" and not value.strip()) or len(value) > 120 or any(ord(c) < 32 for c in value):
            raise ValueError(f"{path.name}: {key} must be a short, single-line string")
    if not isinstance(profile["whatsapp"], str) or not re.fullmatch(r"[1-9][0-9]{6,14}", profile["whatsapp"]):
        raise ValueError("WhatsApp must use international digits, without + or spaces")
    if not isinstance(profile["primary"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", profile["primary"]):
        raise ValueError("Primary colour must be a six-digit hex colour")
    if not https_url(profile["privacy_url"]):
        raise ValueError("Privacy URL must be an absolute HTTPS URL")
    if not isinstance(profile["sources"], dict) or not {"logo", "icon", "portrait"} <= profile["sources"].keys() or not all(https_url(v) for v in profile["sources"].values()):
        raise ValueError("Record official HTTPS source URLs for the logo, icon and portrait")
    logo, portrait = profile["logo"], profile["portrait"]
    if not isinstance(logo, dict) or set(logo) != {"source", "height"} or type(logo["height"]) is not int or not 32 <= logo["height"] <= 120:
        raise ValueError("Logo requires source and an integer height from 32 to 120")
    if not isinstance(portrait, dict) or "source" not in portrait or set(portrait) - {"source", "crop"}:
        raise ValueError("Portrait requires source and an optional crop")
    if "crop" in portrait:
        crop = portrait["crop"]
        if not isinstance(crop, dict) or set(crop) != {"left", "top", "width", "height"} or any(type(v) is not int for v in crop.values()) or min(crop["left"], crop["top"]) < 0 or min(crop["width"], crop["height"]) < 1:
            raise ValueError("Portrait crop requires nonnegative left/top and positive width/height integers")
    for source in (logo["source"], profile["icon"], portrait["source"]):
        if not isinstance(source, str) or Path(source).is_absolute():
            raise ValueError("Artwork paths must be relative to forms/agents")
        local = (path.parent / source).resolve()
        if not local.is_relative_to(path.parent.resolve()) or not local.is_file():
            raise ValueError(f"Missing local artwork or path outside forms/agents: {source}")
    return profile


def render_form(root, slug, profile):
    locations = json.loads((root / "packages/model/locations.json").read_text())
    template = (root / "forms/templates/agent-form.yaml").read_text()
    values = {key: profile[key] for key in ("name", "short_name", "agency", "primary", "privacy_url")}
    values.update(
        agency_office=profile["agency"] + (f' ({profile["office"]})' if profile.get("office") else ""),
        logo_height=profile["logo"]["height"],
        logo_url=f"{ASSET_BASE}/{slug}-logo.png",
        icon_url=f"{ASSET_BASE}/{slug}-icon.png",
        og_url=f"{ASSET_BASE}/{slug}-og.png",
        whatsapp_url=f'https://wa.me/{profile["whatsapp"]}?text=' + quote(f'Hi {profile["short_name"]}, I’d like to discuss my property.', safe=""),
    )
    form = re.sub(r"\$\{([a-z_]+)\}", lambda match: json.dumps(values[match[1]], ensure_ascii=False)[1:-1] if isinstance(values[match[1]], str) else str(values[match[1]]), template)
    return form.replace("@@LOCATION_FIELDS@@\n", render_location_fields(locations, agent_form=True))


def generate(root, agent=None, check=False):
    paths = sorted((root / "forms/agents").glob("*.json"))
    if agent:
        paths = [path for path in paths if path.stem == agent]
    if not paths:
        raise ValueError("No matching agent profile found")
    profiles = [(path, load_profile(path)) for path in paths]
    with tempfile.TemporaryDirectory(prefix="agent-forms-") as directory:
        staged = Path(directory)
        for path, profile in profiles:
            slug = path.stem
            form = render_form(root, slug, profile)
            (staged / f"property-valuation-{slug}.yaml").write_text(form)
            subprocess.run(["node", str(ROOT / "scripts/render-agent-assets.mjs")], input=json.dumps({
                "slug": slug, "profile": profile, "sources": str(path.parent.resolve()),
                "template": str(root / "forms/templates/agent-og.svg"), "output": str(staged),
            }), text=True, check=True)
        changes = []
        for source in sorted(staged.iterdir()):
            target = root / "forms" / (source.name if source.suffix == ".yaml" else f"assets/{source.name}")
            if not target.is_file() or target.read_bytes() != source.read_bytes():
                changes.append(str(target.relative_to(root)))
                if not check:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(source.read_bytes())
        return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", help="Generate one profile slug; omit to generate all agents")
    parser.add_argument("--check", action="store_true", help="Report stale outputs without changing files")
    parser.add_argument("--root", type=Path, default=ROOT, help="Repository or temporary workspace root")
    args = parser.parse_args()
    try:
        changes = generate(args.root.resolve(), args.agent, args.check)
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Agent generation failed: {error}\n")
    print("\n".join(changes) if changes else "Agent outputs are current.")
    if args.check and changes:
        parser.exit(1, "Agent outputs are stale; run npm run generate:agents.\n")


if __name__ == "__main__":
    main()

# Agent forms and artwork

Agent profiles in `forms/agents/*.json` supply identity, branding, contact details,
privacy URL, and local source-artwork paths. Their `sources` objects record the
official URLs. The source directories are inputs; files in this directory and
`forms/property-valuation-{slug}.yaml` are generated outputs.

Use the repository skill at `.agents/skills/add-agent-form/SKILL.md` to onboard an
agent from an official profile. It researches missing details, prepares the local
profile and artwork, generates outputs, and reviews them.

## Generate and verify

Follow the root README’s Node/Python setup first. All dependencies belong to this
repository; generation never needs another checkout, network access, or files in
`/tmp`.

```sh
npm run generate:agents -- --agent janique-kinnear
npm run generate:agents                 # regenerate every profile
npm run check:agents                    # report stale outputs without writing
npm run test:agents                     # generator and location regression tests
npm run validate:agents                 # fetch and validate against frms.dev/schema.json
npx playwright install chromium        # once, for browser previews
npm run preview:agent -- janique-kinnear
```

The preview loads the hosted frms.dev renderer with local YAML and artwork, blocks
analytics and external requests, and mocks every submission. It checks mobile and
desktop layouts, required email, both consent choices, and the completion link;
screenshots are saved in a temporary directory printed by the command. Use
`--output /path/to/screenshots` to choose a directory. An existing Chromium can be
selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Inspect the screenshots as
well as the full-size and reduced sharing artwork before publishing.

Change the profile for agent-specific details. Change `forms/templates/agent-form.yaml`
or `forms/templates/agent-og.svg` for shared copy or layout, then regenerate all
agents. Each generation validates the selected profiles and prepares all outputs
before replacing files. A missing or unsuitable portrait leaves existing outputs
untouched. Generation, schema validation, and preview commands accept
`--root /path/to/workspace` for isolated trials.

The generator safely substitutes quoted text into the YAML template. Preserve its
`${...}` tokens and `@@LOCATION_FIELDS@@` marker. Locations come from
`packages/model/locations.json` through the existing Python location renderer.
Training discovers profiles automatically and keeps their city/suburb choices
aligned with the two legacy forms. It does not rebuild artwork.

## Shared visual pattern

- Light forms with centred official logos. Logo height is an agent setting:
  Janique retains 56px; Vito uses 80px. Agency colours remain agent-specific.
- A 1200×630 sharing image with a 700px text column and full-height 500×630 portrait.
  The typography, headline, dark text, and logo bounding box are shared. There is
  no frame or location caption. The brand colour supplies the accent.
- Real portraits are cropped to fill. An optional source crop keeps a face within
  the frame; coordinates apply after EXIF orientation. Prefer at least 500×630
  usable pixels. Conventional enlargement is limited to 2×, so Vito’s 300×400
  source is accepted. Judge both the full export and a 600×315 sharing preview.
- Names fit within the shared title area: reduce the single-line font if needed,
  then use two lines. Names that still cannot fit require a shorter display name.
- Output: `*-logo.png`, transparent 480×480 `*-icon.png`, `*-og.svg` with embedded
  artwork and editable text, and `*-og.png`. Text uses Arial with Helvetica and
  sans-serif fallbacks; raster pixels can differ across systems with different
  fonts or image-library versions. Generate and check in the same environment.

Janique’s source portrait retains its selected crop; Vito’s trimmed office-logo
source retains its official colours. Source assets and their provenance live
with the profiles, rather than inside temporary generation scripts.

## Publishing

The form’s logo, icon, and sharing image use raw GitHub URLs on this repository’s
`main` branch. Publish each YAML with its generated assets. A new agent’s URLs
will not resolve before those files are pushed. `theme.logo.image` and
`theme.logo.height` require a frms.dev version supporting logo objects.

Both existing agents still use `https://example.invalid/REPLACE_PRIVACY_NOTICE`.
Replace it in each profile with the applicable notice before launch and regenerate.
After publication, check the actual favicon and sharing preview; social platforms
may cache older images. Generating files does not publish them or send leads.

---
name: add-agent-form
description: Add or update an agent-branded property valuation form and sharing artwork in this repository using its shared generator. Use when onboarding an estate agent or changing an existing agent’s branding or contact details.
---

# Add an agent form

Generate from the shared templates; agent profiles supply the permitted differences. Work from the repository root. Read `forms/assets/README.md` for commands, output locations, and publishing prerequisites.

## Gather the agent profile

Start with the user’s official profile link or supplied details. Research the individual agent and their agency’s official website for identity, office, artwork, and brand colour. A team page can use another team member’s photograph: verify the individual portrait. User-confirmed details take precedence over a directory listing. If the preferred WhatsApp number is unresolved, ask rather than treating an office switchboard as their mobile.

Once required details and usable artwork are ready, create `forms/agents/{slug}.json`, following the existing profiles. Keep incomplete intake notes outside `forms/agents/*.json` so automatic discovery does not treat them as ready profiles. The permitted values are:

- `name`, `short_name`, `agency`, and optional `office`: the display identity used in the shared copy. Keep the office out of the portrait area.
- `whatsapp`: international digits, without `+` or spaces.
- `primary`: the agreed six-digit hex colour.
- `privacy_url`: the notice covering this form. If it is not available, retain the existing `https://example.invalid/REPLACE_PRIVACY_NOTICE` draft placeholder and report it as a launch prerequisite.
- `logo`: local `source` plus `height` (32–120 pixels). Start at 56; use 80 for a tall stacked logo when needed. Keep the complete official mark and crop uneven blank margins from its source artwork.
- `icon`: path to the official icon source.
- `portrait`: local `source`, with optional integer `crop` coordinates (`left`, `top`, `width`, `height`) in the oriented source image. Keep the face comfortably within the crop.
- `sources`: official HTTPS provenance URLs for `logo`, `icon`, and `portrait`; include `profile` when available. Optional `notes` can record a user override or source-artwork preparation.

Store source artwork in `forms/agents/{slug}/`. Profile paths are relative to `forms/agents`, so use values such as `alex-example/portrait.jpg`. Inspect downloaded files before generation. Use a real, verified portrait; if none is usable, prepare the remaining details and request a suitable photograph before producing final artwork.

Prefer at least 500×630 usable portrait pixels. The generator allows conventional enlargement up to 2× into the shared 500×630 area, so 300×400 photographs can work. Review the face at both full size and a 600×315 sharing preview. Preserve the actual photograph rather than reconstructing a likeness.

## Generate and check

1. Ensure this repository’s npm dependencies and model virtual environment are installed. Use the existing setup instructions; do not borrow dependencies from another checkout.
2. Run `npm run generate:agents -- --agent {slug}`. Profiles are discovered automatically by the model’s location updater. No Python registration edit is needed.
3. Run `npm run check:agents`, `npm run test:agents`, and `npm run validate:agents`. The last command retrieves the current frms.dev schema; generation and drift checks use only local inputs. Location tests are included in `test:agents`. Generation, validation, and previews accept `--root` for isolated workspaces.
4. Inspect the generated YAML and the full-size and reduced sharing image. Run `npm run preview:agent -- {slug}` (install Chromium once with `npx playwright install chromium`). Inspect its mobile and desktop screenshots for agent identity, logo proportions, and readable copy. The command blocks analytics and mocks submissions while checking consent and the WhatsApp link; never submit production leads for testing.
5. Report the generated files, checks, and any real launch prerequisites. Outputs remain local unless publishing is requested; the GitHub asset URLs need the corresponding files on `main`.

The form template owns fields, consent wording, common copy, webhook, authentication, analytics, and location behaviour. The sharing template owns positions, typography, headline, and portrait treatment. Change a profile for agent-specific details; change a shared template only when asked to change the pattern for all agents, then regenerate and review all agents. Existing generated forms and SVGs are outputs, not copy-and-edit starting points.

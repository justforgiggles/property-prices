# Agent forms and artwork

Edit `forms/template.json` for shared form fields and the lead email. Edit
`forms/agents/{slug}.json` for an agent's identity, branding, contact details, and
artwork. Store source images in `forms/agents/{slug}/`; profile image paths are
relative to `forms/agents`.

```sh
npm run agents
npm test
```

The single Node generator reads `packages/model/locations.json` and produces the
base form, every agent form, and `{slug}-logo.png`, `{slug}-icon.png`,
`{slug}-og.svg`, and `{slug}-og.png` in this directory. Generated YAML stays at
`forms/property-valuation.yaml` and `forms/property-valuation-{slug}.yaml`.
These paths and asset URLs are already live: keep existing slugs unchanged.

Profiles contain name, short name, agency, optional office, WhatsApp digits,
primary colour, privacy URL, and logo/icon/portrait sources. Keep the source URLs
as provenance. `logo.height` controls form display; `logo.show_in_form: false`
hides the form logo. An optional `portrait.crop` selects left/top/width/height
before the photo fills its 500×630 sharing-image area.

`lead_notification_email` enables the shared completed-submission notification.
All four current agents use the same email template. It reports the contact
consent value and uses the existing completed-submission trigger.

Inspect generated forms and sharing images after changing branding. Artwork uses
one fixed layout and name size; choose a shorter display name if a future name
does not fit. Use real portraits and preserve official logos. Updating locations
requires training first, then generation.

Push the inputs and generated outputs to `main`, or manually run the release
workflow after pushing inputs. A new agent also needs their generated form
registered on frms.dev; existing form registrations remain valid.

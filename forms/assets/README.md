# Agent artwork

## Janique Kinnear

- `janique-kinnear-icon.png`: official Knight Frank icon, unchanged (480 × 480, transparent PNG).
- `janique-kinnear-og.png`: sharing image (1200 × 630 PNG), used for Open Graph and Twitter previews.
- `janique-kinnear-og.svg`: editable composition with the portrait and logo embedded; text uses Arial with a sans-serif fallback. Export at 1200 × 630 after editing.

The form’s `theme.icon` and `open_graph.image` point to these PNGs on this repository’s `main` branch through GitHub’s raw-file host. Commit and push the assets and YAML together before publishing the updated form. The URLs will not resolve while the files exist only locally. After publishing, check the live favicon and sharing preview; social platforms may cache older images.

Official source artwork retrieved on 18 October 2026:

- [Knight Frank icon](https://d21tw07c6rnmp0.cloudfront.net/media/uploads/612/themesettings/2024/5/612_aa03f678c82e45a59f17891f49a394cf.png)
- [Knight Frank wordmark](https://d21tw07c6rnmp0.cloudfront.net/media/uploads/612/themesettings/2024/5/612_18a002bedb9744feb200e13d84baa439.svg)
- [Janique Kinnear’s portrait](https://d21tw07c6rnmp0.cloudfront.net/media/uploads/612/undefined/2026/2/612_6d9e84d5d5fe430bbd2b4db8ed3cc3a3.jpg)

The portrait is cropped and resized from the official photograph. It is not AI-generated.

## Vito Wiechmann

- `vito-wiechmann-logo.png`: official RE/MAX Property Associates office logo, unchanged.
- `vito-wiechmann-icon.png`: official RE/MAX icon rendered as a transparent 480 × 480 PNG.
- `vito-wiechmann-og.png`: 1200 × 630 sharing image, with Vito’s individual portrait at its native 300 × 400 size.
- `vito-wiechmann-og.svg`: editable composition with the portrait and logo embedded; export at 1200 × 630 after editing. Text uses Arial with a sans-serif fallback.

Vito’s form follows the same GitHub asset publishing process described above. Its primary colour is RE/MAX red (`#FF1200`), with light mode and WhatsApp contact `27736058190`. Before launch, replace `https://example.invalid/REPLACE_PRIVACY_NOTICE` with the privacy notice covering this form’s collection and sharing of leads. The existing placeholder is intentional for this unpublished draft.

Official sources retrieved on 18 October 2026:

- [Vito’s individual profile](https://www.remax.co.za/agents/vito-wiechmann/880203)
- [Vito’s portrait](https://cdn.remax.co.za/images/agents/880203/member/agent_image_1733820957.jpg)
- [Property Associates office logo](https://s3.eu-west-1.amazonaws.com/cdn.remax.co.za/images/offices/800562/a0f0c99ec0c10e92.png)
- [RE/MAX icon](https://www.remax.co.za/icon.svg)

The portrait is the official photograph, not an AI-generated likeness. The team page’s sharing image depicts another agent and is not used.

## Shared location choices

All valuation forms use the same location catalog. When adding another form, register its filename in `FORM_VARIANTS` in `packages/model/src/property_model/train/locations.py` (`True` for the agent form wording). Training updates every registered form; the location tests detect missing registrations or stale generated fields. Each form keeps its own branding, contact details, and other copy.

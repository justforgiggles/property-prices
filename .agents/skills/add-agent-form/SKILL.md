---
name: add-agent-form
description: Add or update an agent-branded property valuation form and sharing artwork using this repository's shared JSON template and generator.
---

# Add an agent form

1. Read `forms/assets/README.md` and an existing profile. Research the agent's
   official identity, contact details, branding, and portrait; user-confirmed
   details take precedence. Ask only for details that cannot be verified.
2. Create or edit `forms/agents/{slug}.json` and its local source artwork. Preserve
   existing slugs: generated form and asset paths are live URLs. Keep official
   source links in the profile. Use a real portrait, complete logo, international
   WhatsApp digits, and the intended notification email. Retain an existing draft
   privacy placeholder if no notice is supplied, and report that fact.
3. Run `npm run agents`, then `npm test`. The generator reads the fixed JSON
   template and latest location catalog, and generates every form and asset.
   Change the shared template for common fields or email content; profiles supply
   agent differences. Generated outputs are not editing inputs.
4. Inspect the generated YAML and sharing image for the correct identity, contact
   destination, logo proportions, and portrait crop. The artwork has fixed type;
   shorten a display name if necessary. Do not send production leads as tests.
5. Report changed outputs and verification. Publish when requested. Existing
   forms retain their registrations; a new form needs registration on frms.dev.
   Source-only pushes do not release automatically: dispatch the release workflow
   when training, location refresh, and deployment are requested.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ASSET_URL = "https://raw.githubusercontent.com/justforgiggles/property-prices/main/forms/assets";
const png = { compressionLevel: 9, adaptiveFiltering: true };
const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

export function locationFields(locations) {
  const cities = {};
  for (const [province, entries] of Object.entries(locations)) {
    for (const [city, suburbs] of Object.entries(entries)) {
      (cities[city] ??= []).push({ province, suburbs });
    }
  }
  return [
    {
      id: "city", type: "dropdown", label: "Which city or town?", placeholder: "Select a city or town",
      searchable: true, depends_on: "province",
      options_by_parent: Object.fromEntries(Object.entries(locations).map(([province, entries]) => [province, Object.keys(entries)])),
      validators: [{ type: "required", message: "Select a city or town." }],
    },
    {
      id: "suburb", type: "dropdown", label: "Which suburb?", placeholder: "Select a suburb",
      searchable: true, depends_on: "city",
      options_by_parent: Object.fromEntries(Object.entries(cities).map(([city, entries]) => [city,
        entries.length === 1 ? entries[0].suburbs : entries.flatMap(({ province, suburbs }) => suburbs.map(suburb => ({ label: `${suburb} (${province})`, value: suburb }))),
      ])),
      validators: [
        { type: "required", message: "Select a suburb." },
        ...Object.entries(cities).filter(([, entries]) => entries.length > 1).map(([city, entries]) => ({
          type: "expression",
          expression: `data.city !== ${JSON.stringify(city)} || ${entries.map(({ province, suburbs }) => `(data.province === ${JSON.stringify(province)} && ${JSON.stringify(suburbs)}.includes(data.suburb))`).join(" || ")}`,
          message: "Choose a suburb in your selected province.",
        })),
      ],
    },
  ];
}

function createForm(template, locations, slug, profile) {
  const form = structuredClone(template.form);
  const location = form.sections.find(section => section.id === "location");
  location.fields[0].options = Object.keys(locations).map(province => ({
    label: province === "KwaZulu Natal" ? "KwaZulu-Natal" : province, value: province,
  }));
  location.fields.push(...locationFields(locations));
  if (!profile) return form;

  form.title = `${profile.name} | ${profile.agency}`;
  form.theme = { mode: "light", primary: profile.primary, icon: `${ASSET_URL}/${slug}-icon.png` };
  if (profile.logo.show_in_form !== false) {
    form.theme.logo = { image: `${ASSET_URL}/${slug}-logo.png`, height: profile.logo.height };
  }
  form.open_graph = { image: `${ASSET_URL}/${slug}-og.png` };
  form.start.title = `Your home’s asking-price estimate with ${profile.name}`;
  const office = profile.office ? ` (${profile.office})` : "";
  form.start.description = `Planning your next move? Get a free estimate with ${profile.short_name} at ${profile.agency}${office}, based on South African property listings.`;
  const delivery = form.sections.find(section => section.id === "delivery");
  delivery.description += ` You can also request contact from ${profile.short_name}.`;
  const fields = structuredClone(template.agent_fields);
  fields.find(field => field.id === "privacy_notice").content = `Your details are used for your estimate and shared with ${profile.short_name} only if you request contact. [Privacy notice](${profile.privacy_url}).`;
  fields.find(field => field.id === "agent_contact_consent").label = `I’d like ${profile.short_name} to contact me about my property.`;
  delivery.fields.push(...fields);
  form.completion[0].message += ` <br/><br/>Ready for your next move? Chat to ${profile.short_name}.`;
  form.completion[0].button = {
    label: `WhatsApp ${profile.short_name}`,
    url: `https://wa.me/${profile.whatsapp}?text=${encodeURIComponent(`Hi ${profile.short_name}, I’d like to discuss my property.`)}`,
  };
  if (profile.lead_notification_email) {
    form.connections.push({ ...template.lead_email, to: profile.lead_notification_email });
  }
  return form;
}

async function renderAssets(root, slug, profile) {
  const source = name => path.join(root, "forms/agents", name);
  let portrait = sharp(source(profile.portrait.source)).autoOrient();
  if (profile.portrait.crop) portrait = portrait.extract(profile.portrait.crop);
  const photo = await portrait.resize(500, 630, { fit: "cover", position: "centre" }).jpeg({ quality: 92 }).toBuffer();
  const logo = await sharp(source(profile.logo.source), { density: 288 }).resize(640, 640, { fit: "inside" }).png(png).toBuffer();
  const icon = await sharp(source(profile.icon), { density: 288 }).resize(480, 480, { fit: "contain", background: "#00000000" }).png(png).toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description">
  <title id="title">Your home’s asking-price estimate with ${xml(profile.name)}</title>
  <desc id="description">Free online estimate with ${xml(profile.name)} at ${xml(profile.agency)}, with their portrait on the right.</desc>
  <rect width="1200" height="630" fill="#FFFFFF"/>
  <image x="700" y="0" width="500" height="630" xlink:href="data:image/jpeg;base64,${photo.toString("base64")}"/>
  <image x="64" y="62" width="192" height="110" preserveAspectRatio="xMinYMin meet" xlink:href="data:image/png;base64,${logo.toString("base64")}"/>
  <g font-family="Arial, Helvetica, sans-serif">
    <text x="64" y="264" font-size="56" font-weight="700" letter-spacing="-1.5" fill="#202024">${xml(profile.name)}</text>
    <text x="64" y="348" font-size="44" fill="#36363A">Your home’s</text>
    <text x="64" y="404" font-size="44" fill="#36363A">asking-price estimate</text>
    <rect x="64" y="499" width="44" height="4" fill="${xml(profile.primary)}"/>
    <text x="64" y="548" font-size="26" font-weight="700" fill="${xml(profile.primary)}">Free online estimate</text>
  </g>
</svg>\n`;
  const output = suffix => path.join(root, "forms/assets", `${slug}-${suffix}`);
  await fs.mkdir(path.join(root, "forms/assets"), { recursive: true });
  await fs.writeFile(output("logo.png"), logo);
  await fs.writeFile(output("icon.png"), icon);
  await fs.writeFile(output("og.svg"), svg);
  await sharp(Buffer.from(svg)).png(png).toFile(output("og.png"));
}

export async function generate(root = ROOT) {
  const template = JSON.parse(await fs.readFile(path.join(root, "forms/template.json"), "utf8"));
  const locations = JSON.parse(await fs.readFile(path.join(root, "packages/model/locations.json"), "utf8"));
  if (!Object.keys(locations).length) throw new Error("The location catalog is empty; train the model first.");
  const profiles = (await fs.readdir(path.join(root, "forms/agents"))).filter(name => name.endsWith(".json")).sort();
  for (const name of [null, ...profiles]) {
    const slug = name ? path.basename(name, ".json") : null;
    const profile = name ? JSON.parse(await fs.readFile(path.join(root, "forms/agents", name), "utf8")) : null;
    const form = createForm(template, locations, slug, profile);
    if (profile) await renderAssets(root, slug, profile);
    const filename = `property-valuation${slug ? `-${slug}` : ""}.yaml`;
    await fs.writeFile(path.join(root, "forms", filename), "# Generated by npm run agents. Edit forms/template.json or forms/agents/*.json.\n" + yaml.dump(form, { lineWidth: -1, noRefs: true }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generate();
  console.log("Generated the base form, agent forms, and artwork.");
}

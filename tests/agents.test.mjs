import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as yaml from "js-yaml";
import sharp from "sharp";
import { generate, locationFields } from "../scripts/agents.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("generate every live form and asset from profiles, shared template, and locations", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "property-forms-"));
  try {
    await fs.mkdir(path.join(root, "forms"));
    await fs.mkdir(path.join(root, "packages/model"), { recursive: true });
    for (const name of ["forms/agents", "forms/template.json", "packages/model/locations.json"]) {
      await fs.symlink(path.join(ROOT, name), path.join(root, name));
    }
    await generate(root);
    const template = JSON.parse(await fs.readFile(path.join(root, "forms/template.json"), "utf8"));
    const locations = JSON.parse(await fs.readFile(path.join(root, "packages/model/locations.json"), "utf8"));
    const emails = {
      "janique-kinnear": "janique@res.za.knightfrank.com", "vito-wiechmann": "vito@remaxpa.co.za",
      "laszlo-ruzsa": "laszlo@newworldprop.co.za", "wihan-van-wyk": "wihan@simplyre.co.za",
    };
    const filenames = (await fs.readdir(path.join(root, "forms"))).filter(name => name.endsWith(".yaml"));
    assert.deepEqual(filenames.sort(), ["property-valuation.yaml", ...Object.keys(emails).map(slug => `property-valuation-${slug}.yaml`)].sort());
    for (const slug of [null, ...Object.keys(emails)]) {
      const filename = `property-valuation${slug ? `-${slug}` : ""}.yaml`;
      const form = yaml.load(await fs.readFile(path.join(root, "forms", filename), "utf8"));
      assert.deepEqual(form.authentication, template.form.authentication);
      assert.deepEqual(form.measurements, template.form.measurements);
      assert.deepEqual(form.connections[0], template.form.connections[0]);
      assert.equal(form.sections.find(section => section.id === "property").next, "delivery");
      const fields = form.sections.find(section => section.id === "location").fields;
      assert.deepEqual(fields.slice(1), locationFields(locations));
      const contact = form.sections.find(section => section.id === "delivery").fields;
      if (!slug) {
        assert.deepEqual(contact.map(field => field.id), ["first_name", "email"]);
        assert.equal(form.completion[0].button, undefined);
        assert.equal(form.connections.length, 1);
        continue;
      }
      const profile = JSON.parse(await fs.readFile(path.join(root, "forms/agents", `${slug}.json`), "utf8"));
      assert.equal(form.title, `${profile.name} | ${profile.agency}`);
      assert.deepEqual(form.connections[1], { ...template.lead_email, to: emails[slug] });
      assert.equal(form.completion[0].button.url.startsWith(`https://wa.me/${profile.whatsapp}?text=`), true);
      assert.ok(contact.some(field => field.id === "agent_contact_consent"));
      assert.equal(Boolean(form.theme.logo), slug !== "laszlo-ruzsa");
      assert.ok(form.open_graph.image.endsWith(`/forms/assets/${slug}-og.png`));
      for (const suffix of ["logo.png", "icon.png", "og.svg", "og.png"]) {
        const metadata = await sharp(path.join(root, "forms/assets", `${slug}-${suffix}`)).metadata();
        assert.ok(metadata.width > 0 && metadata.height > 0);
        if (suffix.startsWith("og")) assert.deepEqual([metadata.width, metadata.height], [1200, 630]);
        if (suffix === "icon.png") assert.deepEqual([metadata.width, metadata.height], [480, 480]);
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("shared city names reject suburbs from another province and preserve quoted names", () => {
  const locations = {
    North: { 'Shared "city"': ["O'Brien", "Common"], Unique: ["Only"] },
    South: { 'Shared "city"': ["Two", "Common"] },
  };
  const suburb = locationFields(locations)[1];
  const checks = suburb.validators.filter(rule => rule.type === "expression").map(rule => new Function("data", `return ${rule.expression}`));
  for (const [province, cities] of Object.entries(locations)) {
    for (const [city, allowed] of Object.entries(cities)) {
      for (const name of ["O'Brien", "Common", "Two", "Only"]) {
        if (city === "Unique") continue;
        assert.equal(checks.every(check => check({ province, city, suburb: name })), allowed.includes(name));
      }
    }
  }
});

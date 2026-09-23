import type { Request, Response } from "@google-cloud/functions-framework";
import { Ajv } from "ajv";
import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { predictValuation } from "./inference.js";

const locations = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../locations.json"),
    "utf8",
  ),
) as Record<string, Record<string, Array<string>>>;

const validateSubmission = new Ajv().compile({
  $defs: {
    positiveInteger: {
      anyOf: [{ type: "integer" }, { pattern: "^\\d+$", type: "string" }],
    },
  },
  properties: {
    data: {
      properties: {
        bathrooms: { $ref: "#/$defs/positiveInteger" },
        bedrooms: { $ref: "#/$defs/positiveInteger" },
        city: { maxLength: 100, minLength: 1, type: "string" },
        email: {
          maxLength: 254,
          pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
          type: "string",
        },
        first_name: { maxLength: 80, type: "string" },
        floor_area: { $ref: "#/$defs/positiveInteger" },
        rates_and_taxes: { $ref: "#/$defs/positiveInteger" },
        property_type: {
          enum: ["Apartment / Flat", "House", "Townhouse"],
          type: "string",
        },
        province: { maxLength: 100, minLength: 1, type: "string" },
        suburb: { maxLength: 100, minLength: 1, type: "string" },
      },
      required: [
        "bathrooms",
        "bedrooms",
        "city",
        "email",
        "floor_area",
        "property_type",
        "province",
        "rates_and_taxes",
        "suburb",
      ],
      type: "object",
    },
    id: { maxLength: 200, minLength: 1, type: "string" },
    status: { const: "completed" },
  },
  required: ["data", "id", "status"],
  type: "object",
});

const templateDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../email",
);

const templatesPromise = Promise.all([
  readFile(resolve(templateDirectory, "property-valuation.html"), "utf8").then(
    (template) => Handlebars.compile(template),
  ),
  readFile(resolve(templateDirectory, "property-valuation.txt"), "utf8").then(
    (template) => Handlebars.compile(template, { noEscape: true }),
  ),
]);

const zar = new Intl.NumberFormat("en-ZA", {
  currency: "ZAR",
  maximumFractionDigits: 0,
  style: "currency",
});

export function valuationPresentation(
  estimate: Awaited<ReturnType<typeof predictValuation>>,
): {
  confidenceNote: string;
  headline: string;
  intro: string;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
} {
  const range = `${zar.format(estimate.low)} – ${zar.format(estimate.high)}`;
  if (estimate.confidence === "low") {
    return {
      confidenceNote: "This is a low-confidence estimate because this property differs from the model’s stronger comparisons. Treat the range cautiously and consider a professional valuation.",
      headline: "Your estimated property value range",
      intro: "The available listing data does not support a reliable single-value estimate for this property.",
      primaryLabel: "Indicative range",
      primaryValue: range,
      secondaryLabel: "",
      secondaryValue: "",
    };
  }
  if (estimate.recommended === null) {
    throw new Error("Point estimate is missing for a non-low confidence tier");
  }
  if (estimate.confidence === "high") {
    return {
      confidenceNote: "This estimate falls within the model’s higher-confidence group, but it remains an automated asking-price estimate rather than a formal valuation.",
      headline: "Your estimated property value",
      intro: "Based on the details you shared, your property’s recommended value is:",
      primaryLabel: "Recommended value",
      primaryValue: zar.format(estimate.recommended),
      secondaryLabel: "Likely range",
      secondaryValue: range,
    };
  }
  return {
    confidenceNote: "This estimate has moderate confidence, so the likely range is more reliable than the central estimate alone.",
    headline: "Your estimated property value range",
    intro: "Based on the details you shared, the model estimates this likely range:",
    primaryLabel: "Likely range",
    primaryValue: range,
    secondaryLabel: "Central estimate",
    secondaryValue: zar.format(estimate.recommended),
  };
}

export async function valuation(
  request: Request,
  response: Response,
): Promise<void> {
  response.set("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.set("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const submission = { ...request.body, data: { ...request.body?.data } };
  const invalidFirstName =
    typeof submission.data.first_name === "string" &&
    submission.data.first_name !== "" &&
    submission.data.first_name.trim() === "";

  for (const [field, value] of Object.entries(submission.data)) {
    if (typeof value === "string") {
      submission.data[field] = value.trim();
    }
  }

  submission.id =
    typeof submission.id === "string" ? submission.id.trim() : submission.id;

  if (invalidFirstName || !validateSubmission(submission)) {
    response.status(400).json({ error: "Submission is invalid" });
    return;
  }

  const property = {
    bathrooms: Number(submission.data.bathrooms),
    bedrooms: Number(submission.data.bedrooms),
    locality_1: submission.data.city,
    locality_2: submission.data.suburb,
    rates_and_taxes: Number(submission.data.rates_and_taxes),
    region: submission.data.province,
    size: Number(submission.data.floor_area),
    type: submission.data.property_type,
  };

  if (
    [
      [property.bathrooms, 1, 20],
      [property.bedrooms, 1, 20],
      [property.rates_and_taxes, 1, 100000],
      [property.size, 10, 5000],
    ].some(
      ([value, minimum, maximum]) =>
        !Number.isInteger(value) || value < minimum || value > maximum,
    ) ||
    !locations[property.region]?.[property.locality_1]?.includes(
      property.locality_2,
    )
  ) {
    response.status(400).json({ error: "Submission is invalid" });
    return;
  }

  let estimate;

  try {
    estimate = await predictValuation(property);
  } catch {
    response.status(500).json({ error: "Valuation failed" });
    return;
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;

    if (!apiKey || !from) {
      throw new Error("Resend is not configured");
    }

    const [toHtml, toText] = await templatesPromise;
    const presentation = valuationPresentation(estimate);
    const values = {
      ...presentation,
      bathrooms: property.bathrooms,
      bedrooms: property.bedrooms,
      greeting: submission.data.first_name
        ? `Hi ${submission.data.first_name},`
        : "Hello,",
      location: [
        property.locality_2,
        property.locality_1,
        property.region,
      ].join(", "),
      size: `${property.size.toLocaleString("en-ZA")} m²`,
      type: property.type,
    };
    const result = await fetch("https://api.resend.com/emails", {
      body: JSON.stringify({
        from,
        html: toHtml(values),
        subject: "Your South African property value estimate",
        text: toText(values),
        to: [submission.data.email],
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `property-valuation/${submission.id}`,
      },
      method: "POST",
    });

    if (!result.ok) {
      throw new Error(`Resend rejected the email with status ${result.status}`);
    }
  } catch {
    response.status(502).json({ error: "Email delivery failed" });
    return;
  }

  response.status(204).send();
}

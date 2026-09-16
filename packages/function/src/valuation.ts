import type { Request, Response } from "@google-cloud/functions-framework";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { predictValuation, type Property, type Valuation } from "./inference.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROPERTY_TYPES = new Set(["Apartment / Flat", "House", "Townhouse"]);
const locations = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../locations.json"), "utf8"),
) as Record<string, Record<string, Array<string>>>;
const TEMPLATE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../email/property-valuation.html");
const templatePromise = readFile(TEMPLATE_PATH, "utf8");
const zar = new Intl.NumberFormat("en-ZA", {
  currency: "ZAR",
  maximumFractionDigits: 0,
  style: "currency",
});

type ValuationSubmission = {
  email: string;
  firstName: string;
  property: Property;
  submissionId: string;
};

function parseText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  return text && text.length <= maximumLength ? text : null;
}

function parsePositiveInteger(value: unknown, maximum: number): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;

  return typeof number === "number" && Number.isInteger(number) && number > 0 && number <= maximum ? number : null;
}

function parseSubmission(body: unknown): ValuationSubmission | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const submission = body as Record<string, unknown>;
  const submissionId = parseText(submission.id, 200);

  if (submission.status !== "completed" || submissionId === null) {
    return null;
  }

  if (typeof submission.data !== "object" || submission.data === null || Array.isArray(submission.data)) {
    return null;
  }

  const data = submission.data as Record<string, unknown>;
  const bathrooms = parsePositiveInteger(data.bathrooms, 20);
  const bedrooms = parsePositiveInteger(data.bedrooms, 20);
  const email = parseText(data.email, 254);
  const firstName = data.first_name === undefined || data.first_name === "" ? "" : parseText(data.first_name, 80);
  const locality1 = parseText(data.city, 100);
  const locality2 = parseText(data.suburb, 100);
  const region = parseText(data.province, 100);
  const suburbs = region === null || locality1 === null ? undefined : locations[region]?.[locality1];
  const size = parsePositiveInteger(data.floor_area, 5000);
  const type = parseText(data.property_type, 100);

  if (
    bathrooms === null ||
    bedrooms === null ||
    email === null ||
    firstName === null ||
    locality1 === null ||
    locality2 === null ||
    region === null ||
    size === null ||
    type === null ||
    !EMAIL_PATTERN.test(email) ||
    !PROPERTY_TYPES.has(type) ||
    suburbs === undefined ||
    !suburbs.includes(locality2)
  ) {
    return null;
  }

  return {
    email,
    firstName,
    property: {
      bathrooms,
      bedrooms,
      locality_1: locality1,
      locality_2: locality2,
      region,
      size,
      type,
    },
    submissionId,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "'": "&#39;",
    '"': "&quot;",
    "<": "&lt;",
    ">": "&gt;",
  })[character] as string);
}

function renderTemplate(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, name: string) => replacements[name] ?? placeholder);
}

async function toHtml(submission: ValuationSubmission, valuation: Valuation): Promise<string> {
  const location = [submission.property.locality_2, submission.property.locality_1, submission.property.region]
    .filter(Boolean)
    .join(", ");

  return renderTemplate(await templatePromise, {
    BATHROOMS: String(submission.property.bathrooms),
    BEDROOMS: String(submission.property.bedrooms),
    GREETING: submission.firstName ? `Hi ${escapeHtml(submission.firstName)},` : "Hello,",
    HIGH: zar.format(valuation.high),
    LOCATION: escapeHtml(location),
    LOW: zar.format(valuation.low),
    PREHEADER: "Your estimated value and likely range are ready.",
    RECOMMENDED: zar.format(valuation.recommended),
    SIZE: `${submission.property.size.toLocaleString("en-ZA")} m²`,
    TYPE: escapeHtml(submission.property.type),
  });
}

function toText(submission: ValuationSubmission, valuation: Valuation): string {
  const greeting = submission.firstName ? `Hi ${submission.firstName},` : "Hello,";
  const location = [submission.property.locality_2, submission.property.locality_1, submission.property.region]
    .filter(Boolean)
    .join(", ");

  return `${greeting}

Your property value estimate: ${zar.format(valuation.recommended)}
Likely range: ${zar.format(valuation.low)} – ${zar.format(valuation.high)}

Property details used
Type: ${submission.property.type}
Location: ${location}
Bedrooms: ${submission.property.bedrooms}
Bathrooms: ${submission.property.bathrooms}
Floor area: ${submission.property.size.toLocaleString("en-ZA")} m²

This automated estimate compares the details you provided with patterns in recent South African property listing data.

Important: This estimate is indicative only. It is not a formal valuation, bank valuation, offer, or financial advice. It is based on listing information rather than completed sale prices, and the property's actual market value may differ.`;
}

async function sendEmail(submission: ValuationSubmission, valuation: Valuation): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("Resend is not configured");
  }

  const result = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify({
      from,
      html: await toHtml(submission, valuation),
      subject: "Your South African property value estimate",
      text: toText(submission, valuation),
      to: [submission.email],
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `property-valuation/${submission.submissionId}`,
    },
    method: "POST",
  });

  if (!result.ok) {
    throw new Error(`Resend rejected the email with status ${result.status}`);
  }
}

export async function valuation(request: Request, response: Response): Promise<void> {
  response.set("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.set("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const submission = parseSubmission(request.body);

  if (submission === null) {
    response.status(400).json({ error: "Submission is invalid" });
    return;
  }

  let estimate: Valuation;

  try {
    estimate = await predictValuation(submission.property);
  } catch {
    response.status(500).json({ error: "Valuation failed" });
    return;
  }

  try {
    await sendEmail(submission, estimate);
  } catch {
    response.status(502).json({ error: "Email delivery failed" });
    return;
  }

  response.status(204).send();
}

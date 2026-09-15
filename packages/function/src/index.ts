import { http } from "@google-cloud/functions-framework";
import type { Request, Response } from "@google-cloud/functions-framework";

import { predictValuation, type Property } from "./inference.js";

function parseProperty(body: unknown): Property | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const property = body as Record<string, unknown>;
  const allowed = new Set(["bathrooms", "bedrooms", "locality_1", "locality_2", "region", "size", "type"]);

  if (Object.keys(property).some((key) => !allowed.has(key))) {
    return null;
  }

  if ([property.bathrooms, property.bedrooms, property.size].some((number) => typeof number !== "number" || !Number.isFinite(number) || number <= 0)) {
    return null;
  }

  if ([property.region, property.locality_1, property.type].some((label) => typeof label !== "string" || !label.trim())) {
    return null;
  }

  if (property.locality_2 !== undefined && (typeof property.locality_2 !== "string" || !property.locality_2.trim())) {
    return null;
  }

  return {
    bathrooms: property.bathrooms as number,
    bedrooms: property.bedrooms as number,
    locality_1: (property.locality_1 as string).trim(),
    locality_2: typeof property.locality_2 === "string" ? property.locality_2.trim() : "",
    region: (property.region as string).trim(),
    size: property.size as number,
    type: (property.type as string).trim(),
  };
}

export async function predict(request: Request, response: Response): Promise<void> {
  response.set("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.set("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const property = parseProperty(request.body);

  if (property === null) {
    response.status(400).json({ error: "Property details are invalid" });
    return;
  }

  response.status(200).json(await predictValuation(property));
}

http("predict", predict);

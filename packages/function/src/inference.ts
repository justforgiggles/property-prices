import type { Request, Response } from "@google-cloud/functions-framework";
import { Ajv } from "ajv";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";

const MODEL_DIRECTORY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../models",
);

const validateProperty = new Ajv().compile({
  additionalProperties: false,
  properties: {
    bathrooms: { exclusiveMinimum: 0, type: "number" },
    bedrooms: { exclusiveMinimum: 0, type: "number" },
    locality_1: { pattern: "\\S", type: "string" },
    locality_2: { pattern: "\\S", type: "string" },
    region: { pattern: "\\S", type: "string" },
    size: { exclusiveMinimum: 0, type: "number" },
    type: { pattern: "\\S", type: "string" },
  },
  required: ["bathrooms", "bedrooms", "locality_1", "region", "size", "type"],
  type: "object",
});

type Encoders = {
  feature_order: Array<string>;
  global_mean: number;
  global_ppsqm: number;
  interval_log_widen: number;
  loc2_count: Record<string, number>;
  ppsqm_encoding: Record<string, Record<string, number>>;
  target_encoding: Record<string, Record<string, number>>;
};

let modelPromise: Promise<[Encoders, Array<ort.InferenceSession>]> | undefined;

function getEncodedValue(
  tables: Record<string, Record<string, number>>,
  categories: Array<[string, string]>,
  defaultValue: number,
): number {
  for (const [field, category] of categories) {
    const value = tables[field]?.[category];

    if (value !== undefined) {
      return value;
    }
  }

  return defaultValue;
}

export async function predictValuation(property: {
  bathrooms: number;
  bedrooms: number;
  locality_1: string;
  locality_2: string;
  region: string;
  size: number;
  type: string;
}): Promise<{ high: number; low: number; recommended: number }> {
  const [encoders, [lowSession, highSession, recommendedSession]] =
    await (modelPromise ??= Promise.all([
      readFile(join(MODEL_DIRECTORY, "encoders.json"), "utf8").then(
        (json) => JSON.parse(json) as Encoders,
      ),
      Promise.all([
        ort.InferenceSession.create(join(MODEL_DIRECTORY, "model_q10.onnx"), {
          logSeverityLevel: 3,
        }),
        ort.InferenceSession.create(join(MODEL_DIRECTORY, "model_q90.onnx"), {
          logSeverityLevel: 3,
        }),
        ort.InferenceSession.create(join(MODEL_DIRECTORY, "model.onnx"), {
          logSeverityLevel: 3,
        }),
      ]),
    ]));

  const logSize = Math.log(property.size);

  const localityFallbacks: Array<[string, string]> = [
    ["locality_1", property.locality_1],
    ["region", property.region],
  ];

  const pricePerSquareMeter = getEncodedValue(
    encoders.ppsqm_encoding,
    [["locality_2", property.locality_2], ...localityFallbacks],
    encoders.global_ppsqm,
  );

  const features = {
    bathrooms: property.bathrooms,
    bed_bath_ratio: property.bedrooms / (property.bathrooms + 0.5),
    bedrooms: property.bedrooms,
    loc2_log_count: Math.log1p(encoders.loc2_count[property.locality_2] ?? 0),
    log_size: logSize,
    prior_log_price: pricePerSquareMeter + logSize,
    size: property.size,
    size_per_bedroom: property.size / Math.max(property.bedrooms, 0.5),
    te_country: getEncodedValue(
      encoders.target_encoding,
      [["country", "South Africa"]],
      encoders.global_mean,
    ),
    te_locality_1: getEncodedValue(
      encoders.target_encoding,
      [
        ["locality_1", property.locality_1],
        ["region", property.region],
      ],
      encoders.global_mean,
    ),
    te_locality_2: getEncodedValue(
      encoders.target_encoding,
      [["locality_2", property.locality_2], ...localityFallbacks],
      encoders.global_mean,
    ),
    te_ppsqm: pricePerSquareMeter,
    te_region: getEncodedValue(
      encoders.target_encoding,
      [["region", property.region]],
      encoders.global_mean,
    ),
    te_type: getEncodedValue(
      encoders.target_encoding,
      [["type", property.type]],
      encoders.global_mean,
    ),
    total_rooms: property.bedrooms + property.bathrooms,
  };

  const values = encoders.feature_order.map(
    (feature) => features[feature as keyof typeof features],
  );

  const tensor = new ort.Tensor("float32", Float32Array.from(values), [
    1,
    values.length,
  ]);

  const [lowLog, highLog, recommendedLog] = await Promise.all(
    [lowSession, highSession, recommendedSession].map((session) =>
      session
        .run({ [session.inputNames[0]]: tensor })
        .then((outputs) => Number(outputs[session.outputNames[0]].data[0])),
    ),
  );

  const low = Math.expm1(
    Math.min(lowLog, highLog) - encoders.interval_log_widen,
  );

  const high = Math.expm1(
    Math.max(lowLog, highLog) + encoders.interval_log_widen,
  );

  const recommended = Math.min(Math.max(Math.expm1(recommendedLog), low), high);

  if (
    ![low, recommended, high].every(Number.isFinite) ||
    low > recommended ||
    recommended > high
  ) {
    throw new Error("Model produced an invalid valuation");
  }

  return { high, low, recommended };
}

export async function predict(
  request: Request,
  response: Response,
): Promise<void> {
  response.set("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.set("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!validateProperty(request.body)) {
    response.status(400).json({ error: "Property details are invalid" });
    return;
  }

  const property = {
    ...request.body,
    locality_1: request.body.locality_1.trim(),
    locality_2:
      (Reflect.get(request.body, "locality_2") as string | undefined)?.trim() ??
      "",
    region: request.body.region.trim(),
    type: request.body.type.trim(),
  };

  response.status(200).json(await predictValuation(property));
}

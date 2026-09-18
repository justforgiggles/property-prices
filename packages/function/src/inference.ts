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
    bathrooms: { maximum: 20, minimum: 1, type: "integer" },
    bedrooms: { maximum: 20, minimum: 1, type: "integer" },
    locality_1: { pattern: "\\S", type: "string" },
    locality_2: { type: "string" },
    region: { pattern: "\\S", type: "string" },
    size: { maximum: 5000, minimum: 10, type: "number" },
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

const FEATURE_ORDER = [
  "bedrooms",
  "bathrooms",
  "size",
  "size_missing",
  "total_rooms",
  "bed_bath_ratio",
  "size_per_bedroom",
  "log_size",
  "te_region",
  "te_locality_1",
  "te_locality_2",
  "te_type",
  "te_ppsqm",
  "prior_log_price",
  "loc2_log_count",
] as const;

function parseEncoders(json: string): Encoders {
  const value = JSON.parse(json) as Partial<Encoders>;
  const record = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
  const tableMap = (candidate: unknown): boolean =>
    record(candidate) &&
    Object.values(candidate).every(
      (table) =>
        record(table) && Object.values(table).every((item) => Number.isFinite(item)),
    );

  if (
    !Array.isArray(value.feature_order) ||
    value.feature_order.length !== FEATURE_ORDER.length ||
    !value.feature_order.every((feature, index) => feature === FEATURE_ORDER[index]) ||
    !Number.isFinite(value.global_mean) ||
    !Number.isFinite(value.global_ppsqm) ||
    !Number.isFinite(value.interval_log_widen) ||
    !record(value.loc2_count) ||
    !Object.values(value.loc2_count).every(
      (count) => Number.isInteger(count) && Number(count) >= 0,
    ) ||
    !tableMap(value.ppsqm_encoding) ||
    !tableMap(value.target_encoding)
  ) {
    throw new Error("Invalid model encoder artifact");
  }

  return value as Encoders;
}

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
  if (!validateProperty(property)) {
    throw new Error("Property details are invalid");
  }

  const [encoders, [lowSession, highSession, recommendedSession]] =
    await (modelPromise ??= Promise.all([
      readFile(join(MODEL_DIRECTORY, "encoders.json"), "utf8").then(parseEncoders),
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
  const locality1 = `${property.region}|${property.locality_1}`;
  const locality2 = `${locality1}|${property.locality_2}`;

  const localityFallbacks: Array<[string, string]> = [
    ["locality_1", locality1],
    ["region", property.region],
  ];

  const pricePerSquareMeter = getEncodedValue(
    encoders.ppsqm_encoding,
    [["locality_2", locality2], ...localityFallbacks],
    encoders.global_ppsqm,
  );

  const features = {
    bathrooms: property.bathrooms,
    bed_bath_ratio: property.bedrooms / (property.bathrooms + 0.5),
    bedrooms: property.bedrooms,
    loc2_log_count: Math.log1p(encoders.loc2_count[locality2] ?? 0),
    log_size: logSize,
    prior_log_price: pricePerSquareMeter + logSize,
    size: property.size,
    size_missing: 0,
    size_per_bedroom: property.size / Math.max(property.bedrooms, 0.5),
    te_locality_1: getEncodedValue(
      encoders.target_encoding,
      [
        ["locality_1", locality1],
        ["region", property.region],
      ],
      encoders.global_mean,
    ),
    te_locality_2: getEncodedValue(
      encoders.target_encoding,
      [["locality_2", locality2], ...localityFallbacks],
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

  const featureData = Float32Array.from(values);

  if (![...featureData].every(Number.isFinite)) {
    throw new Error("Model features are invalid");
  }

  const tensor = new ort.Tensor("float32", featureData, [1, values.length]);

  const [lowLog, highLog, recommendedLog] = await Promise.all(
    [lowSession, highSession, recommendedSession].map((session) =>
      session
        .run({ [session.inputNames[0]]: tensor })
        .then((outputs) => Number(outputs[session.outputNames[0]].data[0])),
    ),
  );

  const low = Math.max(
    0,
    Math.expm1(Math.min(lowLog, highLog) - encoders.interval_log_widen),
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

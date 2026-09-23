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
    rates_and_taxes: { maximum: 100000, minimum: 1, type: "integer" },
    region: { pattern: "\\S", type: "string" },
    size: { maximum: 5000, minimum: 10, type: "number" },
    type: { pattern: "\\S", type: "string" },
  },
  required: [
    "bathrooms",
    "bedrooms",
    "locality_1",
    "rates_and_taxes",
    "region",
    "size",
    "type",
  ],
  type: "object",
});

type Encoders = {
  confidence: {
    feature_order: Array<string>;
    low_min_error_risk: number;
    precise_max_quantile_log_width: number;
  };
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
  "log_rates_and_taxes",
  "rates_and_taxes_missing",
  "te_region",
  "te_locality_1",
  "te_locality_2",
  "te_type",
  "te_ppsqm",
  "prior_log_price",
  "loc2_log_count",
] as const;

const CONFIDENCE_EXTRA_ORDER = [
  "point_log",
  "quantile_low_log",
  "quantile_high_log",
  "quantile_log_width",
  "point_minus_low",
  "high_minus_point",
  "point_midpoint_offset",
] as const;

const CONFIDENCE_FEATURE_ORDER = [
  ...FEATURE_ORDER,
  ...CONFIDENCE_EXTRA_ORDER,
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
    !record(value.confidence) ||
    !Array.isArray(value.confidence.feature_order) ||
    value.confidence.feature_order.length !== CONFIDENCE_FEATURE_ORDER.length ||
    !value.confidence.feature_order.every(
      (feature, index) => feature === CONFIDENCE_FEATURE_ORDER[index],
    ) ||
    !Number.isFinite(value.confidence.low_min_error_risk) ||
    !Number.isFinite(value.confidence.precise_max_quantile_log_width) ||
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
  rates_and_taxes: number;
  region: string;
  size: number;
  type: string;
}): Promise<{
  confidence: "high" | "low" | "medium";
  errorRisk: number;
  high: number;
  low: number;
  recommended: number | null;
}> {
  if (!validateProperty(property)) {
    throw new Error("Property details are invalid");
  }

  const [encoders, [lowSession, highSession, recommendedSession, confidenceSession]] =
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
        ort.InferenceSession.create(join(MODEL_DIRECTORY, "model_confidence.onnx"), {
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
    log_rates_and_taxes: Math.log1p(property.rates_and_taxes),
    log_size: logSize,
    prior_log_price: pricePerSquareMeter + logSize,
    rates_and_taxes_missing: 0,
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

  const point = Math.min(Math.max(Math.expm1(recommendedLog), low), high);
  const quantileLowLog = Math.min(lowLog, highLog);
  const quantileHighLog = Math.max(lowLog, highLog);
  const confidenceValues = [
    ...values,
    recommendedLog,
    quantileLowLog,
    quantileHighLog,
    quantileHighLog - quantileLowLog,
    recommendedLog - quantileLowLog,
    quantileHighLog - recommendedLog,
    Math.abs(recommendedLog - (quantileLowLog + quantileHighLog) / 2),
  ];
  const confidenceTensor = new ort.Tensor(
    "float32",
    Float32Array.from(confidenceValues),
    [1, confidenceValues.length],
  );
  const confidenceOutputs = await confidenceSession.run({
    [confidenceSession.inputNames[0]]: confidenceTensor,
  });
  const errorRisk = Math.min(
    1,
    Math.max(
      0,
      Number(confidenceOutputs[confidenceSession.outputNames[0]].data[0]),
    ),
  );
  const confidence =
    errorRisk >= encoders.confidence.low_min_error_risk
      ? "low"
      : quantileHighLog - quantileLowLog <=
          encoders.confidence.precise_max_quantile_log_width
        ? "high"
        : "medium";
  const recommended = confidence === "low" ? null : point;

  if (
    ![low, point, high, errorRisk].every(Number.isFinite) ||
    low > point ||
    point > high
  ) {
    throw new Error("Model produced an invalid valuation");
  }

  return { confidence, errorRisk, high, low, recommended };
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

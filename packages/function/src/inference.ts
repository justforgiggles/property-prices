import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";

const MODEL_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../models");

type Encoders = {
  feature_order: Array<string>;
  global_mean: number;
  global_ppsqm: number;
  interval_log_widen: number;
  loc2_count: Record<string, number>;
  ppsqm_encoding: Record<string, Record<string, number>>;
  target_encoding: Record<string, Record<string, number>>;
};

export type Property = {
  bathrooms: number;
  bedrooms: number;
  locality_1: string;
  locality_2: string;
  region: string;
  size: number;
  type: string;
};

export type Valuation = { high: number; low: number; recommended: number };

let encodersPromise: Promise<Encoders> | null = null;
let sessionsPromise: Promise<{ high: ort.InferenceSession; low: ort.InferenceSession; recommended: ort.InferenceSession }> | null = null;

function getEncoders(): Promise<Encoders> {
  encodersPromise ??= readFile(join(MODEL_DIRECTORY, "encoders.json"), "utf8").then((json) => JSON.parse(json) as Encoders);
  return encodersPromise;
}

function getSessions(): Promise<{ high: ort.InferenceSession; low: ort.InferenceSession; recommended: ort.InferenceSession }> {
  sessionsPromise ??= Promise.all([
    ort.InferenceSession.create(join(MODEL_DIRECTORY, "model_q90.onnx"), { logSeverityLevel: 3 }),
    ort.InferenceSession.create(join(MODEL_DIRECTORY, "model_q10.onnx"), { logSeverityLevel: 3 }),
    ort.InferenceSession.create(join(MODEL_DIRECTORY, "model.onnx"), { logSeverityLevel: 3 }),
  ]).then(([high, low, recommended]) => ({ high, low, recommended }));
  return sessionsPromise;
}

function findEncodedValue(tables: Record<string, Record<string, number>>, field: string, category: string, fallbackFields: Array<[string, string]>, defaultValue: number): number {
  if (Object.hasOwn(tables[field] ?? {}, category)) {
    return tables[field][category];
  }

  for (const [fallbackField, fallbackCategory] of fallbackFields) {
    if (Object.hasOwn(tables[fallbackField] ?? {}, fallbackCategory)) {
      return tables[fallbackField][fallbackCategory];
    }
  }

  return defaultValue;
}

export function toModelFeatures(property: Property, encoders: Encoders): Array<number> {
  const logSize = Math.log(property.size);
  const localityFallbacks: Array<[string, string]> = [["locality_1", property.locality_1], ["region", property.region]];
  const pricePerSquareMeter = findEncodedValue(encoders.ppsqm_encoding, "locality_2", property.locality_2, localityFallbacks, encoders.global_ppsqm);
  const features = {
    bathrooms: property.bathrooms,
    bed_bath_ratio: property.bedrooms / (property.bathrooms + 0.5),
    bedrooms: property.bedrooms,
    loc2_log_count: Math.log1p(encoders.loc2_count[property.locality_2] ?? 0),
    log_size: logSize,
    prior_log_price: pricePerSquareMeter + logSize,
    size: property.size,
    size_per_bedroom: property.size / Math.max(property.bedrooms, 0.5),
    te_country: findEncodedValue(encoders.target_encoding, "country", "South Africa", [], encoders.global_mean),
    te_locality_1: findEncodedValue(encoders.target_encoding, "locality_1", property.locality_1, [["region", property.region]], encoders.global_mean),
    te_locality_2: findEncodedValue(encoders.target_encoding, "locality_2", property.locality_2, localityFallbacks, encoders.global_mean),
    te_ppsqm: pricePerSquareMeter,
    te_region: findEncodedValue(encoders.target_encoding, "region", property.region, [], encoders.global_mean),
    te_type: findEncodedValue(encoders.target_encoding, "type", property.type, [], encoders.global_mean),
    total_rooms: property.bedrooms + property.bathrooms,
  };
  return encoders.feature_order.map((feature) => features[feature as keyof typeof features]);
}

function predictLog(session: ort.InferenceSession, values: Array<number>): Promise<number> {
  const tensor = new ort.Tensor("float32", Float32Array.from(values), [1, values.length]);
  return session.run({ [session.inputNames[0]]: tensor }).then((outputs) => Number(outputs[session.outputNames[0]].data[0]));
}

export async function predictValuation(property: Property): Promise<Valuation> {
  const [encoders, sessions] = await Promise.all([getEncoders(), getSessions()]);
  const features = toModelFeatures(property, encoders);
  const [lowLog, highLog, recommendedLog] = await Promise.all([
    predictLog(sessions.low, features),
    predictLog(sessions.high, features),
    predictLog(sessions.recommended, features),
  ]);
  const low = Math.expm1(Math.min(lowLog, highLog) - encoders.interval_log_widen);
  const high = Math.expm1(Math.max(lowLog, highLog) + encoders.interval_log_widen);
  const recommended = Math.min(Math.max(Math.expm1(recommendedLog), low), high);

  if (![low, recommended, high].every(Number.isFinite) || low > recommended || recommended > high) {
    throw new Error("Model produced an invalid valuation");
  }

  return { high, low, recommended };
}

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ort = require("onnxruntime-node");

function getOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function lookup(tableMap, fallbackDefault, column, value, fallbacks) {
  const table = tableMap[column] || {};
  if (Object.prototype.hasOwnProperty.call(table, String(value))) {
    return table[String(value)];
  }
  for (const fallback of fallbacks) {
    const fallbackTable = tableMap[fallback[0]] || {};
    if (Object.prototype.hasOwnProperty.call(fallbackTable, String(fallback[1]))) {
      return fallbackTable[String(fallback[1])];
    }
  }
  return fallbackDefault;
}

function recordToFeatures(record, encoders) {
  const logSize = Math.log(Math.max(record.size, 1e-9));
  const locality1 = `${record.region}|${record.locality_1}`;
  const locality2 = `${locality1}|${record.locality_2}`;
  const localityFallbacks = [
    ["locality_1", locality1],
    ["region", record.region],
  ];
  const pricePerSquareMeter = lookup(
    encoders.ppsqm_encoding,
    encoders.global_ppsqm,
    "locality_2",
    locality2,
    localityFallbacks,
  );
  const features = {
    bathrooms: record.bathrooms,
    bed_bath_ratio: record.bedrooms / (record.bathrooms + 0.5),
    bedrooms: record.bedrooms,
    loc2_log_count: Math.log1p(
      (encoders.loc2_count && encoders.loc2_count[locality2]) || 0,
    ),
    log_size: logSize,
    prior_log_price: pricePerSquareMeter + logSize,
    size: record.size,
    size_missing: 0,
    size_per_bedroom: record.size / Math.max(record.bedrooms, 0.5),
    te_locality_1: lookup(
      encoders.target_encoding,
      encoders.global_mean,
      "locality_1",
      locality1,
      [["region", record.region]],
    ),
    te_locality_2: lookup(
      encoders.target_encoding,
      encoders.global_mean,
      "locality_2",
      locality2,
      localityFallbacks,
    ),
    te_ppsqm: pricePerSquareMeter,
    te_region: lookup(
      encoders.target_encoding,
      encoders.global_mean,
      "region",
      record.region,
      [],
    ),
    te_type: lookup(
      encoders.target_encoding,
      encoders.global_mean,
      "type",
      record.type,
      [],
    ),
    total_rooms: record.bedrooms + record.bathrooms,
  };
  const values = encoders.feature_order.map((feature) => Number(features[feature]));
  if (!values.every(Number.isFinite)) {
    throw new Error("Encoder produced invalid model features");
  }
  return values;
}

async function predictLog(session, values) {
  const data = Float32Array.from(values);
  if (![...data].every(Number.isFinite)) {
    throw new Error("Encoder produced invalid float32 model features");
  }
  const tensor = new ort.Tensor(
    "float32",
    data,
    [1, values.length],
  );
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  return Number(outputs[session.outputNames[0]].data[0]);
}

async function main() {
  const modelDirectory = path.resolve(getOption("--model-dir") || "models");
  const recordsPath = path.resolve(
    getOption("--records") || path.join(__dirname, "verification-records.json"),
  );
  const expectedFiles = [
    "encoders.json",
    "model.onnx",
    "model_q10.onnx",
    "model_q90.onnx",
  ];
  const files = fs.readdirSync(modelDirectory).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Artifact contract mismatch: ${files.join(", ")}`);
  }

  const encoders = JSON.parse(
    fs.readFileSync(path.join(modelDirectory, "encoders.json"), "utf-8"),
  );
  const sessions = {
    high: await ort.InferenceSession.create(
      path.join(modelDirectory, "model_q90.onnx"),
      { logSeverityLevel: 3 },
    ),
    low: await ort.InferenceSession.create(
      path.join(modelDirectory, "model_q10.onnx"),
      { logSeverityLevel: 3 },
    ),
    recommended: await ort.InferenceSession.create(
      path.join(modelDirectory, "model.onnx"),
      { logSeverityLevel: 3 },
    ),
  };
  const records = JSON.parse(fs.readFileSync(recordsPath, "utf-8"));
  const predictions = [];
  for (const record of records) {
    const values = recordToFeatures(record, encoders);
    const lowLog = await predictLog(sessions.low, values);
    const highLog = await predictLog(sessions.high, values);
    const widening = Number(encoders.interval_log_widen || 0);
    const low = Math.max(0, Math.expm1(Math.min(lowLog, highLog) - widening));
    const high = Math.expm1(Math.max(lowLog, highLog) + widening);
    const recommended = Math.min(
      Math.max(Math.expm1(await predictLog(sessions.recommended, values)), low),
      high,
    );
    if (![low, recommended, high].every(Number.isFinite) || !(low <= recommended && recommended <= high)) {
      throw new Error("ONNX produced an invalid prediction interval");
    }
    predictions.push({ high, low, recommended });
  }

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(predictions));
  } else {
    console.log(`Verified ${predictions.length} ONNX predictions in ${modelDirectory}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../models");
const expected = ["encoders.json", "model.onnx", "model_q10.onnx", "model_q90.onnx"];

async function main() {
  const files = (await readdir(directory)).sort();

  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new Error("Function source is missing the verified model bundle");
  }

  for (const name of expected) {
    if ((await stat(join(directory, name))).size === 0) {
      throw new Error(`Model artifact is empty: ${name}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

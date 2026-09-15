import { access, copyFile, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageDirectory, "../model/models");
const destination = join(packageDirectory, "models");
const expected = ["encoders.json", "model.onnx", "model_q10.onnx", "model_q90.onnx"];

async function main() {
  const files = (await readdir(source)).sort();

  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new Error("Verified model bundle is missing or contains unexpected files; train first");
  }

  const stage = await mkdtemp(join(packageDirectory, ".models-stage-"));
  const backup = join(packageDirectory, ".models-backup");

  try {
    for (const name of expected) {
      await copyFile(join(source, name), join(stage, name));
    }

    try {
      await access(destination);
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      try {
        await rename(backup, destination);
      } catch (backupError) {
        if (backupError.code !== "ENOENT") {
          throw backupError;
        }
      }
    }

    try {
      await rename(destination, backup);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }

    try {
      await rename(stage, destination);
    } catch (error) {
      try {
        await rename(backup, destination);
      } catch {
        // No previous bundle existed.
      }
      throw error;
    }

    await rm(backup, { recursive: true, force: true });
    console.log("Prepared verified ONNX bundle for the function");
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

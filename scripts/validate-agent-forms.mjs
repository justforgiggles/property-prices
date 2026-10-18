import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { load } from 'js-yaml';

const { values } = parseArgs({ options: { root: { type: 'string' } } });
const root = values.root ? path.resolve(values.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const response = await fetch('https://frms.dev/schema.json');
if (!response.ok) throw new Error(`Could not fetch frms.dev schema: ${response.status}`);
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(await response.json());
for (const file of (await fs.readdir(path.join(root, 'forms/agents'))).filter(file => file.endsWith('.json'))) {
  const filename = `property-valuation-${path.basename(file, '.json')}.yaml`;
  const form = load(await fs.readFile(path.join(root, 'forms', filename), 'utf8'));
  if (!validate(form)) throw new Error(`${filename}: ${JSON.stringify(validate.errors)}`);
  console.log(`${filename}: valid against the current frms.dev schema`);
}

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';

const registeredOnly = process.argv.includes('--registered-only');
const profiles = (await fs.readdir('forms/agents')).filter(name => name.endsWith('.json')).sort();
const stems = ['property-valuation', ...profiles.map(name => `property-valuation-${name.slice(0, -5)}`)];
for (const stem of stems) {
  const id = 'a' + crypto.createHash('md5').update(`forms/justforgiggles/property-prices/forms/${stem}@main`).digest('hex').slice(0, 8);
  const expected = { ...load(await fs.readFile(`forms/${stem}.yaml`, 'utf8')), id };
  let failure;
  for (let attempt = 0; attempt < (registeredOnly ? 1 : 36); attempt++) {
    try {
      const response = await fetch(`https://frms.dev/api/v1/forms/${id}`, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
      assert.equal(response.status, 200, `${stem} (${id}) must already be registered on frms.dev`);
      const actual = await response.json();
      if (!registeredOnly) {
        assert.deepEqual(actual, expected, `${stem}: hosted definition differs from release`);
        for (const suffix of stem === 'property-valuation' ? [] : ['logo.png', 'icon.png', 'og.png', 'og.svg']) {
          const filename = `${stem.slice('property-valuation-'.length)}-${suffix}`;
          const asset = await fetch(`https://raw.githubusercontent.com/justforgiggles/property-prices/main/forms/assets/${filename}`, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
          assert.equal(asset.status, 200, `${filename}: unavailable`);
          assert.deepEqual(Buffer.from(await asset.arrayBuffer()), await fs.readFile(`forms/assets/${filename}`), `${filename}: hosted bytes differ`);
        }
      }
      failure = undefined;
      break;
    } catch (error) {
      failure = error;
      if (!registeredOnly) await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  if (failure) throw failure;
  console.log(`${stem} (${id}): ${registeredOnly ? 'registered' : 'published and verified'}`);
}

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { load } from 'js-yaml';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { root: { type: 'string' }, output: { type: 'string' } } });
const [slug] = positionals;
if (positionals.length !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('Usage: npm run preview:agent -- agent-slug [--root directory] [--output directory]');
const root = values.root ? path.resolve(values.root) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = values.output ? path.resolve(values.output) : await fs.mkdtemp(path.join(os.tmpdir(), 'agent-preview-'));
await fs.mkdir(output, { recursive: true });
const form = load(await fs.readFile(path.join(root, `forms/property-valuation-${slug}.yaml`), 'utf8'));
form.id = 'a00000000';
delete form.measurements;
const url = `https://frms.dev/${form.id}?lang=en`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
try {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'dark', serviceWorkers: 'block' });
    let data = {};
    const posts = [];
    await context.route('**/*', async route => {
      const request = route.request(), target = new URL(request.url());
      if (target.hostname === 'frms.dev' && target.pathname.startsWith('/api/v1/forms/')) {
        if (request.method() === 'POST') {
          const body = request.postDataJSON();
          posts.push(body);
          data = { ...data, ...body };
          return route.fulfill({ json: { id: 'preview-submission' } });
        }
        return route.fulfill({ json: target.pathname.includes('/submissions/') ? { data } : form });
      }
      if (request.method() !== 'GET') return route.abort();
      if (target.hostname === 'raw.githubusercontent.com' && target.pathname.includes('/forms/assets/')) {
        return route.fulfill({ contentType: 'image/png', body: await fs.readFile(path.join(root, 'forms/assets', path.basename(target.pathname))) });
      }
      if (target.hostname === 'frms.dev') return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    async function capture(step) {
      await page.waitForFunction(() => [...document.images].some(img => img.alt === '' && img.complete && img.naturalWidth > 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `${slug}-${step}-${width}.png`), fullPage: true });
    }
    await page.goto(url, { waitUntil: 'networkidle' });
    const start = page.getByRole('button', { name: form.start.button, exact: true });
    await start.waitFor();
    assert.equal(await page.locator('html').getAttribute('data-form-theme'), 'light');
    const contrast = await start.evaluate(el => {
      const luminance = color => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const style = getComputedStyle(el), text = luminance(style.color), background = luminance(style.backgroundColor);
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    });
    assert.ok(contrast >= 4.5, `Button contrast is ${contrast.toFixed(2)}:1; choose a readable brand colour`);
    await capture('start');
    await start.click();
    await page.getByText('Property location', { exact: true }).waitFor();
    await capture('location');
    await page.goto(`${url}&step=delivery`, { waitUntil: 'networkidle' });
    await page.locator('input[name=email]').waitFor();
    assert.equal(await page.getByRole('checkbox').getAttribute('aria-checked'), 'false');
    await capture('contact');
    await page.getByRole('button', { name: 'Show my estimate' }).click();
    await page.getByText('Enter your email address.', { exact: true }).waitFor();
    assert.equal(posts.length, 0);
    await page.locator('input[name=email]').fill('preview@example.com');
    await page.getByRole('button', { name: 'Show my estimate' }).click();
    await page.getByText(form.completion[1].title, { exact: true }).waitFor();
    assert.equal(posts.at(-1).agent_contact_consent, false);
    data = { prediction: { recommended_asking_price_zar: 1844000, formatted_asking_price: 'R 1 844 000' } };
    await page.goto(`${url}&step=delivery`, { waitUntil: 'networkidle' });
    await page.locator('input[name=email]').fill('preview@example.com');
    await page.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Show my estimate' }).click();
    await page.getByText('R 1 844 000', { exact: true }).waitFor();
    assert.equal(posts.at(-1).agent_contact_consent, true);
    assert.equal(await page.getByRole('link', { name: form.completion[0].button.label }).getAttribute('href'), form.completion[0].button.url);
    await capture('completion');
    await context.close();
    console.log(`${slug}: ${width}px preview and mocked submission checks passed`);
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
}

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const png = { compressionLevel: 9, adaptiveFiltering: true };

async function textWidth(text, size) {
  const image = await sharp({ text: { text: xml(text), font: `Arial Bold ${size}`, rgba: true, dpi: 72 } }).metadata();
  return image.width;
}

async function nameLines(name) {
  for (let size = 56; size >= 44; size -= 2) {
    if (await textWidth(name, size) <= 572) {
      return `<text x="64" y="264" font-size="${size}" font-weight="700" letter-spacing="-1.5" fill="#202024">${xml(name)}</text>`;
    }
  }
  const words = name.split(/\s+/);
  let best;
  for (let index = 1; index < words.length; index++) {
    const lines = [words.slice(0, index).join(' '), words.slice(index).join(' ')];
    const width = Math.max(...await Promise.all(lines.map(line => textWidth(line, 40))));
    if (width <= 572 && (!best || width < best.width)) best = { lines, width };
  }
  if (!best) throw new Error('Agent name does not fit the sharing title; supply a shorter display name.');
  return best.lines.map((line, index) => `<text x="64" y="${222 + index * 48}" font-size="40" font-weight="700" fill="#202024">${xml(line)}</text>`).join('\n    ');
}

async function render(job) {
  const profile = job.profile;
  const source = name => path.join(job.sources, name);
  let portrait = sharp(source(profile.portrait.source)).autoOrient();
  if (profile.portrait.crop) portrait = portrait.extract(profile.portrait.crop);
  const cropped = await portrait.toBuffer();
  const dimensions = await sharp(cropped).metadata();
  if (Math.max(500 / dimensions.width, 630 / dimensions.height) > 2) {
    throw new Error('Portrait is too small for the shared layout; provide at least 250×315 usable pixels after cropping.');
  }
  const photo = await sharp(cropped).resize(500, 630, { fit: 'cover', position: 'centre' }).jpeg({ quality: 92 }).toBuffer();
  const logo = await sharp(source(profile.logo.source), { density: 288 }).resize(640, 640, { fit: 'inside' }).png(png).toBuffer();
  const icon = await sharp(source(profile.icon), { density: 288 }).resize(480, 480, { fit: 'contain', background: '#00000000' }).png(png).toBuffer();
  const values = {
    NAME: xml(profile.name), AGENCY: xml(profile.agency), PRIMARY: profile.primary,
    NAME_LINES: await nameLines(profile.name), LOGO: logo.toString('base64'), PORTRAIT: photo.toString('base64'),
  };
  const template = await fs.readFile(job.template, 'utf8');
  const svg = template.replace(/@@([A-Z_]+)@@/g, (token, key) => {
    if (!(key in values)) throw new Error(`Unknown sharing template token: ${token}`);
    return values[key];
  });
  const output = suffix => path.join(job.output, `${job.slug}-${suffix}`);
  await fs.writeFile(output('logo.png'), logo);
  await fs.writeFile(output('icon.png'), icon);
  await fs.writeFile(output('og.svg'), svg);
  await sharp(Buffer.from(svg)).png(png).toFile(output('og.png'));
}

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  await render(JSON.parse(input));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

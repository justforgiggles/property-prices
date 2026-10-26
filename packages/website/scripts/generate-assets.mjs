import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { site } from "../site.config.mjs";

const website = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = join(website, "public");
const icons = join(publicDirectory, "icons");
const social = join(publicDirectory, "social");
const fontfile = join(website, "assets/fonts/Geist.ttf");
process.env.FONTCONFIG_FILE ??= join(website, "assets/fonts/fonts.conf");
const radar = await readFile(join(website, "assets/radar.svg"));
await mkdir(icons, { recursive: true });
await mkdir(social, { recursive: true });
const faviconSvg = Buffer.from(
  radar.toString().replace(
    /(<svg[^>]*>)/,
    `$1<rect width="32" height="32" rx="4" fill="${site.background}"/>`,
  ),
);
await writeFile(join(icons, "icon.svg"), faviconSvg);

for (const [name, size] of [
  ["favicon-96.png", 96],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
]) {
  const padding = name === "apple-touch-icon.png" ? 18 : 0;
  await sharp(radar, { density: 1200 })
    .resize(size - padding * 2, size - padding * 2)
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: site.background,
    })
    .flatten({ background: site.background })
    .png()
    .toFile(join(icons, name));
}

const faviconSizes = [16, 32, 48];
const faviconImages = await Promise.all(
  faviconSizes.map((size) =>
    sharp(faviconSvg, { density: 1200 }).resize(size, size).png().toBuffer(),
  ),
);
const header = Buffer.alloc(6 + faviconSizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(faviconSizes.length, 4);
let offset = header.length;

for (const [index, size] of faviconSizes.entries()) {
  const entry = 6 + index * 16;
  header[entry] = size;
  header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(faviconImages[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += faviconImages[index].length;
}

await writeFile(
  join(publicDirectory, "favicon.ico"),
  Buffer.concat([header, ...faviconImages]),
);

const mark = radar.toString().replace(/<svg[^>]*>|<\/svg>/g, "");
const background = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" color="${site.foreground}">
<rect width="1200" height="630" fill="${site.background}"/>
<g transform="translate(80 64) scale(2.25)" fill="none">${mark}</g>
<path d="M88 477H1112" stroke="#dcded2" stroke-width="2"/>
</svg>`;
const labels = [
  { text: "PROP RADAR", x: 173, y: 83, size: 30, weight: 600, spacing: 3 },
  {
    text: "A local view of",
    x: 88,
    y: 214,
    size: 84,
    weight: 500,
    spacing: -2,
  },
  {
    text: "property listings.",
    x: 88,
    y: 310,
    size: 84,
    weight: 500,
    spacing: -2,
  },
  {
    text: "SOUTH AFRICAN PROPERTY LISTING DATA",
    x: 88,
    y: 526,
    size: 21,
    weight: 500,
    spacing: 2,
  },
];
const layers = [];

for (const label of labels) {
  const image = await sharp({
    text: {
      text: `<span foreground="${site.foreground}" weight="${label.weight}" letter_spacing="${label.spacing * 1024}">${label.text}</span>`,
      font: `Geist ${label.size}`,
      fontfile,
      dpi: 72,
      rgba: true,
    },
  })
    .png()
    .toBuffer();
  layers.push({ input: image, left: label.x, top: label.y });
}

await sharp(Buffer.from(background))
  .composite(layers)
  .png()
  .toFile(join(social, "prop-radar.png"));
const embeddedFont = (await readFile(fontfile)).toString("base64");
const editableSvg = background.replace(
  "</svg>",
  `<style>@font-face{font-family:Geist;src:url(data:font/ttf;base64,${embeddedFont}) format('truetype');font-weight:100 900}</style>
${labels.map((label) => `<text x="${label.x}" y="${label.y}" dominant-baseline="hanging" fill="${site.foreground}" font-family="Geist,sans-serif" font-size="${label.size}" font-weight="${label.weight}" letter-spacing="${label.spacing}">${label.text}</text>`).join("\n")}
</svg>`,
);
await writeFile(join(website, "assets/social-card.svg"), editableSvg);
console.log(
  "Generated social PNG, editable SVG, favicon, and application icons.",
);

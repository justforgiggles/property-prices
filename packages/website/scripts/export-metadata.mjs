import { readFile, writeFile, rm } from "node:fs/promises";

const output = new URL("../out/", import.meta.url);
const configuredOrigin = process.env.SITE_URL;
let robots = "User-agent: *\nAllow: /\nDisallow: /design-system/\n";

if (configuredOrigin) {
  const origin = new URL(configuredOrigin);

  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      "SITE_URL must be an HTTP(S) origin without credentials, path, query or fragment.",
    );
  }

  const catalog = JSON.parse(
    await readFile(
      new URL("../.generated/reports.json", import.meta.url),
      "utf8",
    ),
  );
  const paths = [
    "/",
    "/methodology/",
    ...catalog.cities.map((city) => city.href),
    ...catalog.pairs.map((pair) => pair.href),
  ];
  const urls = paths
    .map(
      (path) =>
        `<url><loc>${new URL(path, origin).href.replaceAll("&", "&amp;")}</loc></url>`,
    )
    .join("");
  await writeFile(
    new URL("sitemap.xml", output),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`,
  );
  robots += `Sitemap: ${new URL("/sitemap.xml", origin).href}\n`;
} else {
  await rm(new URL("sitemap.xml", output), { force: true });
}

await writeFile(new URL("robots.txt", output), robots);

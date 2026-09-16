import * as cheerio from "cheerio";

import { captureListing, findPublicationDate, readListingIdCheckpoint, updateListingIdCheckpoint, type RawListing } from "./storage.js";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
};

type City = { id: number; name: string; parentName: string; type: number };
type SearchPage = { listings: Array<{ id: number; url: string }>; next: string | null };

export function parseListingId(url: string): number | null {
  const id = Number(new URL(url).pathname.split("/").filter(Boolean).at(-1));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseSearchPage(html: string, url: string): SearchPage {
  const $ = cheerio.load(html);

  if (!/property.*for sale/i.test($("title").text())) {
    throw new Error(`Property24 did not return a sale results page: ${url}`);
  }

  const hiddenClasses = new Set<string>();

  $("style").each((_, style) => {
    for (const match of ($(style).html() ?? "").matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
      if (/position\s*:\s*absolute/i.test(match[2]) && /left\s*:\s*-\d+px/i.test(match[2])) {
        hiddenClasses.add(match[1]);
      }
    }
  });

  const listings = $(".p24_tileContainer.js_resultTile, .js_groupedResultTile.p24_tileContainer")
    .toArray()
    .filter((element) => !($(element).attr("class") ?? "").split(/\s+/).some((name) => hiddenClasses.has(name)))
    .map((element) => $(element).find("a[href*='/for-sale/']").first().attr("href"))
    .filter((href): href is string => typeof href === "string")
    .map((href) => new URL(href, url).href)
    .map((listingUrl) => ({ id: parseListingId(listingUrl), url: listingUrl }))
    .filter((listing): listing is { id: number; url: string } => listing.id !== null);

  const nextHref = $(".p24_pager a")
    .toArray()
    .map((element) => ({ label: $(element).text().replace(/\s+/g, " ").trim(), href: $(element).attr("href") ?? "" }))
    .find((link) => /^next\b/i.test(link.label) && link.href)?.href;

  return {
    listings,
    next: nextHref && nextHref !== "javascript:;" ? new URL(nextHref, url).href : null,
  };
}

export function parseDetailPage(html: string, url: string): RawListing {
  const id = parseListingId(url);

  if (id === null) {
    throw new Error(`Invalid Property24 listing URL: ${url}`);
  }

  const $ = cheerio.load(html);
  const jsonld: Array<unknown> = [];

  for (const script of $("script[type='application/ld+json']").toArray()) {
    try {
      jsonld.push(JSON.parse($(script).text()) as unknown);
    } catch {
      continue;
    }
  }

  if (jsonld.length === 0) {
    throw new Error(`Property24 listing has no JSON-LD: ${url}`);
  }

  return { id, jsonld };
}

export async function fetchText(url: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });

      if (!response.ok) {
        throw new Error(`Property24 request failed (${response.status}): ${url}`);
      }

      return response.text();
    } catch (error: unknown) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;

      if (attempt === 2 || (code !== "ETIMEDOUT" && code !== "UND_ERR_CONNECT_TIMEOUT")) {
        throw error;
      }
    }
  }

  throw new Error(`Property24 request failed: ${url}`);
}

export async function getCitySearchUrls(): Promise<Array<string>> {
  const response = await fetch("https://www.property24.com/autocomplete/propertiesgrouped", {
    headers: { accept: "application/json", "user-agent": HEADERS["user-agent"] },
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`Property24 location discovery failed (${response.status})`);
  }

  const grouped = (await response.json()) as Record<string, Array<City>>;
  const areas = Object.values(grouped).flat();
  const provinces = new Set(areas.filter((area) => area.type === 5).map((area) => area.name));

  if (provinces.size !== 9) {
    throw new Error(`Expected nine Property24 provinces, found ${provinces.size}`);
  }

  const cities = areas.filter((area) => area.type === 2 && provinces.has(area.parentName));

  if (cities.length < 600) {
    throw new Error(`Property24 returned only ${cities.length} city locations`);
  }

  return [...new Set(cities.map((city) => {
    const citySlug = city.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const provinceSlug = city.parentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const url = new URL(`https://www.property24.com/for-sale/${citySlug}/${provinceSlug}/${city.id}`);
    url.searchParams.set("PropertyCategory", "House,ApartmentOrFlat,Townhouse");
    return url.href;
  }))].sort();
}

export async function crawlSearch(url: string, directory: string, ids: Set<number>, after: string, detailDelayMs: number): Promise<number> {
  let next: string | null = url;
  let checkpointId = (await readListingIdCheckpoint(directory, after))?.id ?? null;
  const visited = new Set<string>();
  let captured = 0;

  while (next !== null) {
    if (visited.has(next)) {
      throw new Error(`Property24 repeated a pagination URL: ${next}`);
    }

    visited.add(next);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(detailDelayMs, 1_000)));
    const page = parseSearchPage(await fetchText(next), next);

    for (const listing of page.listings) {
      if ((checkpointId !== null && listing.id <= checkpointId) || ids.has(listing.id)) {
        continue;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, detailDelayMs));
      const detail = parseDetailPage(await fetchText(listing.url), listing.url);
      const publicationDate = findPublicationDate(detail);

      if (publicationDate !== null && publicationDate < after) {
        checkpointId = checkpointId === null ? detail.id : Math.max(checkpointId, detail.id);
        await updateListingIdCheckpoint(directory, after, checkpointId);
        continue;
      }

      if (await captureListing(directory, ids, detail, after)) {
        captured += 1;
      }
    }

    next = page.next;
  }

  return captured;
}

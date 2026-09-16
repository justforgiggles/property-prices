import * as cheerio from "cheerio";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
};
const PROVINCES = new Set(["Western Cape", "Gauteng", "KwaZulu Natal"]);

type City = { id: number; name: string; parentName: string; type: number };
export type RawListing = { id: number; jsonld: Array<unknown> };

export class SearchPage {
  private page: Promise<cheerio.CheerioAPI> | null = null;

  public constructor(private readonly url: string) {}

  public async parseAll(): Promise<Array<string>> {
    const $ = await this.load();
    const hiddenClasses = new Set<string>();

    $("style").each((_, style) => {
      for (const match of ($(style).html() ?? "").matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
        if (/position\s*:\s*absolute/i.test(match[2]) && /left\s*:\s*-\d+px/i.test(match[2])) {
          hiddenClasses.add(match[1]);
        }
      }
    });

    return $(".p24_tileContainer.js_resultTile, .js_groupedResultTile.p24_tileContainer")
      .toArray()
      .filter((element) => !($(element).attr("class") ?? "").split(/\s+/).some((name) => hiddenClasses.has(name)))
      .map((element) => $(element).find("a[href*='/for-sale/']").first().attr("href"))
      .filter((href): href is string => typeof href === "string")
      .map((href) => new URL(href, this.url).href)
      .filter((url) => parseListingId(url) !== null);
  }

  public async next(): Promise<string | null> {
    const $ = await this.load();
    const href = $(".p24_pager a")
      .toArray()
      .map((element) => ({ label: $(element).text().replace(/\s+/g, " ").trim(), href: $(element).attr("href") ?? "" }))
      .find((link) => /^next\b/i.test(link.label) && link.href)?.href;

    return href && href !== "javascript:;" ? new URL(href, this.url).href : null;
  }

  private load(): Promise<cheerio.CheerioAPI> {
    this.page ??= fetchText(this.url).then((html) => {
      const $ = cheerio.load(html);

      if (!/property.*for sale/i.test($("title").text())) {
        throw new Error(`Property24 did not return a sale results page: ${this.url}`);
      }

      return $;
    });

    return this.page;
  }
}

export class ListingPage {
  public readonly id: number;

  public constructor(private readonly url: string) {
    const id = parseListingId(url);

    if (id === null) {
      throw new Error(`Invalid Property24 listing URL: ${url}`);
    }

    this.id = id;
  }

  public async parse(): Promise<RawListing> {
    const $ = cheerio.load(await fetchText(this.url));
    const jsonld: Array<unknown> = [];

    for (const script of $("script[type='application/ld+json']").toArray()) {
      try {
        jsonld.push(JSON.parse($(script).text()) as unknown);
      } catch {
        continue;
      }
    }

    if (jsonld.length === 0) {
      throw new Error(`Property24 listing has no JSON-LD: ${this.url}`);
    }

    return { id: this.id, jsonld };
  }
}

export class Autocomplete {
  public static async findAll(): Promise<Array<string>> {
    const response = await fetch("https://www.property24.com/autocomplete/propertiesgrouped", {
      headers: { accept: "application/json", "user-agent": HEADERS["user-agent"] },
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Property24 location discovery failed (${response.status})`);
    }

    const grouped = (await response.json()) as Record<string, Array<City>>;
    const areas = Object.values(grouped).flat();
    const cities = areas.filter((area) => area.type === 2 && PROVINCES.has(area.parentName));
    const returnedProvinces = new Set(cities.map((city) => city.parentName));
    const missingProvinces = [...PROVINCES].filter((province) => !returnedProvinces.has(province));

    if (missingProvinces.length > 0) {
      throw new Error(`Property24 returned no city locations for: ${missingProvinces.join(", ")}`);
    }

    return [...new Set(cities.map((city) => {
      const citySlug = city.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const provinceSlug = city.parentName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const url = new URL(`https://www.property24.com/for-sale/${citySlug}/${provinceSlug}/${city.id}`);
      url.searchParams.set("PropertyCategory", "House,ApartmentOrFlat,Townhouse");
      return url.href;
    }))].sort();
  }
}

function parseListingId(url: string): number | null {
  const id = Number(new URL(url).pathname.split("/").filter(Boolean).at(-1));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function fetchText(url: string): Promise<string> {
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

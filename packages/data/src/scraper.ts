import { ListingPage, SearchPage } from "./property24.js";
import { Storage } from "./storage.js";

export async function crawlSearch(url: string, storage: Storage, cutoffDate: string, detailDelayMs: number): Promise<number> {
  let next: string | null = url;
  const visited = new Set<string>();
  let captured = 0;

  while (next !== null) {
    if (visited.has(next)) {
      throw new Error(`Property24 repeated a pagination URL: ${next}`);
    }

    visited.add(next);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(detailDelayMs, 1_000)));
    const searchPage: SearchPage = new SearchPage(next);
    let hasRecentOrganicListing = false;

    for (const searchListing of await searchPage.parseAll()) {
      const listingPage = new ListingPage(searchListing.url);

      if (await storage.hasListing(listingPage.id)) {
        continue;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, detailDelayMs));
      const listing = await listingPage.parse();
      const publicationDate = storage.findListingPublicationDate(listing);

      if (publicationDate === null || publicationDate < cutoffDate) {
        continue;
      }

      hasRecentOrganicListing ||= !searchListing.promoted;

      if (await storage.insertListing(listing)) {
        captured += 1;
      }
    }

    next = hasRecentOrganicListing ? await searchPage.next() : null;
  }

  return captured;
}

import { ListingPage, SearchPage } from "./property24.js";
import { Storage } from "./storage.js";

export async function crawlSearch(url: string, storage: Storage, cutoffDate: string, detailDelayMs: number, reportProgress?: (message: string) => void): Promise<number> {
  let next: string | null = url;
  const visited = new Set<string>();
  let captured = 0;
  let page = 0;

  while (next !== null) {
    if (visited.has(next)) {
      throw new Error(`Property24 repeated a pagination URL: ${next}`);
    }

    visited.add(next);
    page += 1;
    reportProgress?.(`page ${page} started`);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(detailDelayMs, 1_000)));
    const searchPage: SearchPage = new SearchPage(next, reportProgress);
    let hasRecentOrganicListing = false;
    let reachedCutoff = false;
    const capturedBeforePage = captured;
    const searchListings = await searchPage.parseAll();

    for (const searchListing of searchListings) {
      const listingPage = new ListingPage(searchListing.url, reportProgress);

      if (await storage.hasListing(listingPage.id)) {
        reportProgress?.(`listing ${listingPage.id} skipped: already captured (${searchListing.url})`);
        continue;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, detailDelayMs));
      const listing = await listingPage.parse();
      const publicationDate = storage.findListingPublicationDate(listing);

      if (publicationDate === null) {
        reportProgress?.(`listing ${listingPage.id} skipped: no publication date (${searchListing.url})`);
        continue;
      }

      if (publicationDate < cutoffDate) {
        reportProgress?.(`listing ${listingPage.id} skipped: published ${publicationDate} before cutoff ${cutoffDate} (${searchListing.url})`);

        if (!searchListing.promoted) {
          reachedCutoff = true;
          reportProgress?.(`cutoff reached at listing ${listingPage.id}; stopping city`);
          break;
        }

        continue;
      }

      hasRecentOrganicListing ||= !searchListing.promoted;

      if (await storage.insertListing(listing)) {
        captured += 1;
      }
    }

    next = hasRecentOrganicListing && !reachedCutoff ? await searchPage.next() : null;
    reportProgress?.(`page ${page} finished, ${searchListings.length} results, ${captured - capturedBeforePage} new listings`);
  }

  return captured;
}

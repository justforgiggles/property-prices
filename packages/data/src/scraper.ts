import { ListingPage, SearchPage } from "./property24.js";
import { Storage } from "./storage.js";

export async function crawlSearch(url: string, storage: Storage, cutoffDate: string, detailDelayMs: number): Promise<number> {
  let next: string | null = url;
  let checkpointId = await storage.findListingIdCheckpoint(cutoffDate);
  const visited = new Set<string>();
  let captured = 0;

  while (next !== null) {
    if (visited.has(next)) {
      throw new Error(`Property24 repeated a pagination URL: ${next}`);
    }

    visited.add(next);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(detailDelayMs, 1_000)));
    const searchPage: SearchPage = new SearchPage(next);

    for (const listingUrl of await searchPage.parseAll()) {
      const listingPage = new ListingPage(listingUrl);

      if ((checkpointId !== null && listingPage.id <= checkpointId) || await storage.hasListing(listingPage.id)) {
        continue;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, detailDelayMs));
      const listing = await listingPage.parse();
      const publicationDate = storage.findListingPublicationDate(listing);

      if (publicationDate !== null && publicationDate < cutoffDate) {
        checkpointId = checkpointId === null ? listing.id : Math.max(checkpointId, listing.id);
        await storage.updateListingIdCheckpoint(cutoffDate, checkpointId);
        continue;
      }

      if (await storage.insertListing(listing)) {
        captured += 1;
      }
    }

    next = await searchPage.next();
  }

  return captured;
}

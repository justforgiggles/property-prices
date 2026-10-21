// Loaded only by the droplet worker; the existing scraper remains unchanged.
import { randomUUID } from "node:crypto";
import { ProxyAgent } from "undici";

const username = process.env.OXYLABS_USERNAME;
const password = process.env.OXYLABS_PASSWORD;
if (!username || !password) throw new Error("Both Oxylabs credentials are required");
const originalFetch = globalThis.fetch;
let bytes = 0;

globalThis.fetch = async (url, options = {}) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const country = attempt === 2 ? "gb" : "za";
    const dispatcher = new ProxyAgent({
      uri: "http://pr.oxylabs.io:7777",
      token: `Basic ${Buffer.from(`customer-${username}-cc-${country}-sessid-${randomUUID().replaceAll("-", "")}:${password}`).toString("base64")}`,
    });
    try {
      const response = await originalFetch(url, { ...options, dispatcher, signal: AbortSignal.timeout(60_000) });
      const chunks = [];
      if (response.body) {
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          if (bytes > 10_000_000_000) {
            console.error("Estimated 10GB proxy transfer limit reached");
            process.exit(1);
          }
          chunks.push(chunk);
        }
      }
      if (!response.ok) throw new Error("Unsuccessful response");
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
    } catch {
      console.error(`Proxy request attempt ${attempt + 1}/3 failed (${country})`);
      if (attempt === 2) throw new Error("Proxy request failed after three attempts");
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    } finally {
      await dispatcher.destroy();
    }
  }
};

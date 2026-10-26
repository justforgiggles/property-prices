export const site = {
  url: "https://justforgiggles.github.io/property-prices/",
  name: "Prop Radar",
  title: "South African Property Listing Data by City | Prop Radar",
  description:
    "Buying or selling? Explore recorded listing counts by South African city, based on property advertisements published in the past 90 days.",
  language: "en-ZA",
  background: "#faf9f4",
  foreground: "#173e33",
};

export const basePath = new URL(site.url).pathname.replace(/\/$/, "");

export function siteUrl(path = "") {
  return new URL(path, site.url).href;
}

export const socialImage = {
  url: siteUrl("social/prop-radar.png"),
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Prop Radar — A local view of property listings. Radar logo and green lettering on a cream background.",
};

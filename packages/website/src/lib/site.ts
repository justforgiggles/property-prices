import type { Metadata } from "next";

export function getPageMetadata(
  title: string,
  description: string,
  pathname: string,
): Metadata {
  const origin = process.env.SITE_URL;

  return {
    title,
    description,
    ...(origin
      ? { alternates: { canonical: new URL(pathname, origin).href } }
      : {}),
    openGraph: {
      title: title.includes("Home Atlas") ? title : `${title} | Home Atlas`,
      description,
      type: "website",
      locale: "en_ZA",
      siteName: "Home Atlas",
    },
  };
}

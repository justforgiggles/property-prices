import type { Metadata } from "next";
import type { ReactElement } from "react";

import { CityDirectory } from "@/components/city-directory";
import { SiteShell } from "@/components/site-shell";
import data from "@/data/cities.json";
import { site, siteUrl, socialImage } from "@/site.config.mjs";

export const metadata: Metadata = {
  title: { absolute: site.title },
  description: site.description,
  alternates: { canonical: site.url },
  robots: { index: true, follow: true, "max-image-preview": "large" },
  openGraph: {
    type: "website",
    title: site.title,
    description: site.description,
    url: site.url,
    siteName: site.name,
    locale: "en_ZA",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: [{ url: socialImage.url, alt: socialImage.alt }],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": siteUrl("#website"),
      url: site.url,
      name: site.name,
      description: site.description,
      inLanguage: site.language,
    },
    {
      "@type": "WebPage",
      "@id": siteUrl("#webpage"),
      url: site.url,
      name: site.title,
      description: site.description,
      inLanguage: site.language,
      isPartOf: { "@id": siteUrl("#website") },
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: socialImage.url,
        width: socialImage.width,
        height: socialImage.height,
        caption: socialImage.alt,
      },
    },
  ],
};

export default function HomePage(): ReactElement {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <SiteShell>
        <section
          className="mx-auto max-w-2xl pt-10 text-center sm:pt-14"
          aria-labelledby="hero-title"
        >
          <h1
            id="hero-title"
            className="text-4xl font-medium leading-[1.12] tracking-tight text-balance sm:text-6xl"
          >
            A local view of property listings.
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
            Buying or selling? Find your city to see how many listings in our
            data were published in the past 90 days.
          </p>
        </section>
        <CityDirectory cities={data.cities} />
      </SiteShell>
    </>
  );
}

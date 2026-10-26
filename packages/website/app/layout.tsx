import type { Metadata, Viewport } from "next";
import type { ReactElement, ReactNode } from "react";
import { site, siteUrl } from "@/site.config.mjs";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  applicationName: site.name,
  title: { default: site.name, template: `%s | ${site.name}` },
  icons: {
    icon: [
      {
        url: siteUrl("favicon.ico"),
        sizes: "16x16 32x32 48x48",
        type: "image/x-icon",
      },
      {
        url: siteUrl("icons/favicon-96.png"),
        sizes: "96x96",
        type: "image/png",
      },
      { url: siteUrl("icons/icon.svg"), sizes: "any", type: "image/svg+xml" },
    ],
    apple: [
      {
        url: siteUrl("icons/apple-touch-icon.png"),
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  manifest: siteUrl("manifest.webmanifest"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: site.background,
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang={site.language}>
      <body className="min-h-svh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}

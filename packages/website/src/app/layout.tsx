import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import "./globals.css";
import "./pages.css";

export const metadata: Metadata = {
  title: {
    default: "Home Atlas — A field guide to home asking prices",
    template: "%s | Home Atlas",
  },
  description:
    "Explore city reports on home asking prices across Gauteng, Western Cape and KwaZulu-Natal. Houses, flats and townhouses, with clear ranges and visible evidence.",
  applicationName: "Home Atlas",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <html lang="en-ZA" className="antialiased font-sans">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}

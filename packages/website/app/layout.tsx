import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prop Radar",
  description: "A clearer view of South African property prices.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang="en">
      <body className="min-h-svh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}

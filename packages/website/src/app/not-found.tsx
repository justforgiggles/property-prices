import Link from "next/link";
import type { ReactElement } from "react";
import { SiteHeader, SiteFooter } from "@/components/atlas";
import { Button } from "@/components/ui/button";

export default function NotFound(): ReactElement {
  return (
    <>
      <SiteHeader />
      <main id="main" className="shell page-intro min-h-[60vh]">
        <p className="eyebrow">A different starting point</p>
        <h1>
          We couldn’t find
          <br />
          <em>that report.</em>
        </h1>
        <p className="intro-copy mb-8">
          Explore cities we cover to find a report or comparison.
        </p>
        <Button asChild>
          <Link href="/#cities">Explore cities</Link>
        </Button>
      </main>
      <SiteFooter />
    </>
  );
}

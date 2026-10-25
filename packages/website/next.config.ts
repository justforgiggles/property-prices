import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/property-prices",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

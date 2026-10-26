import type { NextConfig } from "next";
import { basePath } from "./site.config.mjs";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

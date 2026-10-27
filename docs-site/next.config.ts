import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

// The docs site lives inside the main Lekhan repo, which also has a lockfile.
// Pin Turbopack's root here so the main app's PostCSS/Tailwind config never
// leaks into this app's build.
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: appRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);

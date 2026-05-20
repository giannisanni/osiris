import type { NextConfig } from "next";

// substrate-local edit: allow cross-origin dev requests from our hostnames.
// Without this Next.js 16 blocks /_next/* asset + HMR fetches from
// http://substrate:3100/ etc., which manifests as a blank black globe.
const allowed = (process.env.ALLOWED_DEV_ORIGIN || "substrate,substrate.tail9b3f2c.ts.net,100.84.87.107,localhost")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["react-map-gl", "mapbox-gl", "maplibre-gl"],
  typescript: { ignoreBuildErrors: true },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  allowedDevOrigins: allowed,
};

export default nextConfig;

import type { NextConfig } from "next";

const githubPages = process.env.GITHUB_PAGES === "true";
// STATIC_EXPORT=1: fully static, relative-path build in out/ for phones (installable web app) and simple file hosting.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = githubPages
  ? { output: "export", basePath: "/IB" }
  : staticExport
    ? { output: "export", assetPrefix: ".", images: { unoptimized: true } }
    : {};

export default nextConfig;

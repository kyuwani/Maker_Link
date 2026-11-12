import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 개발 서버(.next)를 건드리지 않고 빌드만 따로 확인할 때: NEXT_DIST_DIR=.next-build npm run build
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["three"],
};

export default nextConfig;

import path from "node:path";
import type { NextConfig } from "next";

const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8765";

const nextConfig: NextConfig = {
  /** Parent repo has its own package-lock; keep tracing scoped to this app */
  outputFileTracingRoot: path.join(process.cwd(), ".."),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

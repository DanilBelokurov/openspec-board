/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pick up instrumentation.ts — single, deterministic boot
  // point for the background watcher (lib/watcher.ts). Without
  // this flag Next.js ignores instrumentation.ts entirely.
  experimental: {
    instrumentationHook: true,
  },
  webpack(config, { isServer, nextRuntime }) {
    // The instrumentation hook runs on both Node and Edge
    // runtimes, but `lib/watcher.ts` → `lib/config.ts` →
    // `fs/promises` is Node-only. We rewrite webpack's module
    // resolution so that any `require("./lib/watcher")` inside
    // the edge-bundled copy of `instrumentation.ts` becomes a
    // no-op stub. On Node (where we actually need the watcher)
    // the import is left intact.
    //
    // Next.js treats `nextRuntime === "edge"` as the signal for
    // the edge bundle; `"nodejs"` for the Node bundle.
    if (isServer && nextRuntime === "edge") {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        "./lib/watcher": false,
      };
    }
    return config;
  },
};

export default nextConfig;
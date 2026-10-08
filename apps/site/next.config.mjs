// Build-time previews (lib/demo.ts) open the same createDemoWorld as scripts/prebuild.mjs, whose days roll
// over at local midnight; pin UTC so build workers and prebuild agree on the world whatever the machine's zone.
process.env.TZ = 'UTC';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ['@fleet/ui', '@fleet/shared'],
  poweredByHeader: false,
};
export default nextConfig;

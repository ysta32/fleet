/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ['@fleet/ui', '@fleet/shared'],
  poweredByHeader: false,
};
export default nextConfig;

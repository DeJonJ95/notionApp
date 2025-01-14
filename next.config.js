/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
    // pdf-parse pulls in pdfjs which has dynamic requires Next can't bundle.
    // Leave them as external CJS at runtime instead.
    serverComponentsExternalPackages: ['pdf-parse'],
  },
};

module.exports = nextConfig;

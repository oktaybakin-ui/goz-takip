/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://vercel.live",
              "style-src 'self' 'unsafe-inline' https://vercel.live",
              "font-src 'self' https://vercel.live data:",
              "img-src 'self' data: blob: https://vercel.com https://vercel.live",
              "media-src 'self' blob:",
              "connect-src 'self' https://cdn.jsdelivr.net https://vercel.live",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "frame-src https://vercel.live",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };
    return config;
  },
};

module.exports = nextConfig;

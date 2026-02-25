/** @type {import('next').NextConfig} */
const nextConfig = {
  // Compiler optimizasyonları
  swcMinify: true,
  compiler: {
    removeConsole: {
      exclude: ['error', 'warn'],
    },
  },
  experimental: {
    optimizeCss: true,
  },
  // CSS optimizasyonları
  compiler: {
    removeConsole: {
      exclude: ['error', 'warn'],
    },
    // Emotion desteği (eğer kullanılırsa)
    emotion: false,
  },
  // Production optimizasyonları
  productionBrowserSourceMaps: false,
  // CSS modülleri için optimizasyon
  cssModules: {
    localIdentName: '[hash:base64:5]',
  },
  webpack: (config, { isServer }) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };
    
    // Production optimizasyonları
    if (!isServer) {
      config.optimization = {
        ...config.optimization,
        runtimeChunk: 'single',
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: {
              minChunks: 2,
              priority: -20,
              reuseExistingChunk: true,
            },
            vendors: {
              test: /[\\/]node_modules[\\/]/,
              priority: -10,
            },
            common: {
              minChunks: 2,
              priority: -5,
              reuseExistingChunk: true,
            },
          },
        },
      };
    }
    
    return config;
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://vercel.live",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' blob: data:",
              "media-src 'self' blob:",
              "connect-src 'self' https://cdn.jsdelivr.net https://vercel.live wss://ws-us3.pusher.com",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: [
    'rem-agent-core',
    'rem-agent-bridge',
    'better-sqlite3',
    'awilix',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'better-sqlite3': 'commonjs better-sqlite3',
        'rem-agent-core': 'module rem-agent-core',
        'rem-agent-bridge': 'module rem-agent-bridge',
      });
    }
    return config;
  },
};

export default nextConfig;

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['rem-agent-core', 'rem-agent-bridge', 'better-sqlite3'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'better-sqlite3': 'commonjs better-sqlite3',
      });
    }
    return config;
  },
};

export default nextConfig;

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ['@roller-bay/shared'],
};

export default nextConfig;

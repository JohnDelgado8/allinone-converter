// next.config.js
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Other config options you might have can go here */

  // Add this section to increase the body size limit
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb', // Set to your desired limit, e.g., 10MB or more
    },
  },

  // You can also add other configurations if needed, for example:
  // images: {
  //   remotePatterns: [
  //     {
  //       protocol: 'https',
  //       hostname: 'example.com',
  //     },
  //   ],
  // },
};

export default nextConfig;
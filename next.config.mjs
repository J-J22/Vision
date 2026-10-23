/** @type {import('next').NextConfig} */
const nextConfig = {
  // Generated apps live in workspaces/; keep the dev server from watching them
  webpack: (config) => {
    config.watchOptions = { ...config.watchOptions, ignored: ["**/workspaces/**", "**/templates/**", "**/node_modules/**"] };
    return config;
  },
};
export default nextConfig;

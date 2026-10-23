/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets two Vision servers run side by side (e.g. real + fake mode) without overwriting each other's build files
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Generated apps live in workspaces/; keep the dev server from watching them
  webpack: (config) => {
    config.watchOptions = { ...config.watchOptions, ignored: ["**/workspaces/**", "**/templates/**", "**/node_modules/**"] };
    return config;
  },
};
export default nextConfig;

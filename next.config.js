/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required so Next.js can transpile Three.js ESM-only packages
  transpilePackages: ['three', 'three-stdlib'],
  // Allow ngrok tunnels to connect cleanly to next dev server
  allowedDevOrigins: ['*.ngrok-free.app', '*.ngrok-free.dev', '*.ngrok.io'],
}

module.exports = nextConfig

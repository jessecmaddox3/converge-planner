/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@electric-sql/pglite", "proper-lockfile", "googleapis", "@supabase/supabase-js", "@google/genai"],
};

module.exports = nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async redirects() {
    return [
      { source: "/", destination: "/desafio-sugestoes", permanent: false },
      {
        source: "/desafio-sugestoes.html",
        destination: "/desafio-sugestoes",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

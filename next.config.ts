import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (base locale de développement) embarque du WebAssembly : on ne le bundle pas.
  serverExternalPackages: ["@electric-sql/pglite", "playwright", "playwright-core", "@react-pdf/renderer"],
  // Polices du PDF de restitution, lues sur disque au moment du rendu
  outputFileTracingIncludes: { "/api/clients/[id]/restitution/pdf": ["./assets/fonts/**"], "/clients/[id]/restitution": ["./assets/fonts/**"] },
  poweredByHeader: false,
  async headers() {
    const communs = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      // Jamais affichée dans un cadre, sauf l'aperçu du PDF de restitution, dans l'application elle-même
      { source: "/((?!api/clients/[^/]+/restitution/pdf).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, ...communs] },
      { source: "/api/clients/:id/restitution/pdf", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }, ...communs] },
    ];
  },
};

export default nextConfig;

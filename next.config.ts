import type { NextConfig } from "next";
import { publicIndexingAllowed } from "./src/config/indexing";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // The development toolbar renders outside the application tree and can
  // transiently widen WebKit's root scroll area while the dev server compiles.
  // It is not shipped in production and must not contaminate reflow evidence.
  ...(process.env.APP_E2E_FIXTURE_MODE === "true" ? { devIndicators: false as const } : {}),
  turbopack: {
    root: process.cwd(),
  },
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.applypack.work" }],
        destination: "https://applypack.work/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    const stagingHeaders = publicIndexingAllowed()
      ? []
      : [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }];

    return [
      {
        source: "/:path(admin|api|auth|checkout|get-started|my-applypack|sign-in|staging)/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        source: "/(.*)",
        headers: [
          ...stagingHeaders,
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(self)",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "form-action 'self' https://checkout.stripe.com",
              "frame-ancestors 'none'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              process.env.NODE_ENV === "production" ? "script-src 'self' 'unsafe-inline' https://js.stripe.com" : "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com",
              process.env.NODE_ENV === "production"
                ? "connect-src 'self' https://*.supabase.co https://api.stripe.com https://api.resend.com"
                : "connect-src 'self' https://*.supabase.co https://api.stripe.com https://api.resend.com http://127.0.0.1:54321 http://localhost:54321 ws://127.0.0.1:54321 ws://localhost:54321",
              "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
              "object-src 'none'",
              // WebKit upgrades local HTTP assets too; the development server
              // does not serve TLS. Keep the directive on every deployed build.
              ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
            ].join("; "),
          },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, private" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/api/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, private" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;

export const siteConfig = {
  name: "ApplyPack",
  legalEntity: process.env.APP_LEGAL_ENTITY_NAME || "DuoTap LLC",
  url: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  email: {
    support: "support@applypack.work",
    accessibility: "accessibility@applypack.work",
    privacy: "privacy@applypack.work",
  },
  promise: "We find the jobs. We get you ready to apply.",
  navigation: [
    { href: "/how-it-works", label: "How It Works" },
    { href: "/experience-connections", label: "See the Connections" },
    { href: "/before-and-after", label: "Before and After" },
    { href: "/pricing", label: "Pricing" },
    { href: "/faq", label: "FAQ" },
  ],
  publicRoutes: [
    "/",
    "/how-it-works",
    "/job-search-help",
    "/experience-connections",
    "/before-and-after",
    "/resume-screening",
    "/not-just-ai",
    "/pricing",
    "/faq",
    "/about",
    "/get-started",
    "/contact",
    "/accessibility",
    "/privacy",
    "/terms",
  ],
} as const;

export type NavigationItem = (typeof siteConfig.navigation)[number];

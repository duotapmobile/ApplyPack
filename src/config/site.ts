export const siteConfig = {
  name: "ApplyPack",
  legalEntity: process.env.APP_LEGAL_ENTITY_NAME || "DuoTap LLC d/b/a ApplyPack",
  url: process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === "production" ? "https://applypack.work" : "http://localhost:3000"),
  email: { orders: "orders@applypack.work", support: "help@applypack.work", accessibility: "help@applypack.work", privacy: "help@applypack.work", admin: "admin@applypack.work" },
  promise: "We find the jobs. We get you ready to apply.",
  navigation: [
    { href: "/why-apply-pack", label: "Why Apply Pack?" },
    { href: "/how-it-works", label: "How It Works" },
    { href: "/experience-connections", label: "How Matching Works" },
    { href: "/before-and-after", label: "Before and After" },
    { href: "/pricing", label: "Pricing" },
    { href: "/faq", label: "FAQ" },
  ],
  publicRoutes: ["/", "/why-apply-pack", "/how-it-works", "/job-search-help", "/experience-connections", "/before-and-after", "/resume-screening", "/not-just-ai", "/pricing", "/faq", "/about", "/get-started", "/contact", "/accessibility", "/privacy", "/terms"],
} as const;

export type NavigationItem = (typeof siteConfig.navigation)[number];

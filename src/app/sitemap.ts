import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return siteConfig.publicRoutes
    .map((route) => ({
      url: siteConfig.url + route,
      lastModified: new Date(route === "/why-apply-pack" ? "2026-09-03" : "2026-09-01"),
      changeFrequency: route === "/" ? "weekly" as const : "monthly" as const,
      priority: route === "/" ? 1 : route === "/pricing" || route === "/how-it-works" ? 0.8 : 0.6,
    }));
}

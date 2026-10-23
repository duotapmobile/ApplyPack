import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { publicIndexingAllowed } from "@/config/indexing";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!publicIndexingAllowed()) return [];
  return siteConfig.publicRoutes
    .map((route) => ({
      url: new URL(route, siteConfig.url).href,
      // Omit lastModified until a per-page content revision is recorded.
      // A release/build date is not evidence that every page changed.
      changeFrequency: route === "/" ? "weekly" as const : "monthly" as const,
      priority: route === "/" ? 1 : route === "/pricing" || route === "/how-it-works" ? 0.8 : 0.6,
    }));
}

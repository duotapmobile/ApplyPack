import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { publicIndexingAllowed } from "@/config/indexing";

export default function robots(): MetadataRoute.Robots {
  if (!publicIndexingAllowed()) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api", "/auth", "/checkout", "/get-started", "/my-applypack", "/sign-in", "/staging"],
      },
    ],
    sitemap: new URL("/sitemap.xml", siteConfig.url).href,
    host: siteConfig.url,
  };
}

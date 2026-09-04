import type { Metadata, Viewport } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { siteConfig } from "@/config/site";
import "./globals.css";
import "./brief.css";
import "./intake-brief.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: "24-Hour Job Search Help + Tailored Resumes | ApplyPack", template: "%s | ApplyPack" },
  description: "Get 10 researched job matches within 24 hours for $20. Choose the jobs you want, then add a tailored resume and cover letter for $8 per selected job.",
  keywords: ["job search help", "job matching service", "tailored resume", "cover letter service", "career change support", "ApplyPack"],
  openGraph: { type: "website", siteName: "ApplyPack", title: "We find the jobs. We get you ready to apply.", description: "10 researched job matches for $20, delivered within 24 hours after intake and payment are complete.", url: "/", images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "ApplyPack job search and application help" }], locale: "en_US" },
  robots: { index: true, follow: true }, applicationName: "ApplyPack", manifest: "/manifest.webmanifest", category: "business",
  authors: [{ name: "DuoTap LLC d/b/a ApplyPack" }], creator: "DuoTap LLC d/b/a ApplyPack", publisher: "DuoTap LLC d/b/a ApplyPack", referrer: "strict-origin-when-cross-origin", formatDetection: { address: false, email: false, telephone: false },
  twitter: { card: "summary_large_image", title: "We find the jobs. We get you ready to apply.", description: "10 researched job matches for $20, delivered within 24 hours after intake and payment are complete.", images: ["/opengraph-image"] },
};
export const viewport: Viewport = { themeColor: "#021185", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const organizationData = { "@context": "https://schema.org", "@type": "Organization", name: siteConfig.name, legalName: siteConfig.legalEntity, url: siteConfig.url, email: siteConfig.email.support };
  const serviceData = { "@context": "https://schema.org", "@type": "Service", name: "ApplyPack Job Search and Application Help", provider: { "@type": "Organization", name: siteConfig.legalEntity }, areaServed: "US", offers: [{ "@type": "Offer", name: "10 Researched Job Matches", price: "20.00", priceCurrency: "USD" }, { "@type": "Offer", name: "Tailored Resume + Cover Letter", price: "8.00", priceCurrency: "USD" }] };
  return <html lang="en-US"><body><a className="skip-link" href="#main-content">Skip to main content</a><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationData).replace(/</g, "\u003c") }} /><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceData).replace(/</g, "\u003c") }} /><SiteHeader />{children}<SiteFooter /></body></html>;
}

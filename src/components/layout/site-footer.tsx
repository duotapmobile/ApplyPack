import Image from "next/image";
import Link from "next/link";

import { siteConfig } from "@/config/site";

const groups = [
  {
    title: "Service",
    links: [
      ["/how-it-works", "How It Works"],
      ["/job-search-help", "Job Search Help"],
      ["/experience-connections", "See the Connections"],
      ["/before-and-after", "Before and After"],
      ["/pricing", "Pricing"],
      ["/faq", "FAQ"],
    ],
  },
  {
    title: "About",
    links: [
      ["/about", "About ApplyPack"],
      ["/contact", "Contact"],
      ["/accessibility", "Accessibility"],
    ],
  },
  {
    title: "Legal",
    links: [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"]],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-frame footer-grid">
        <div className="footer-brand">
          <Link className="brand" href="/" aria-label="ApplyPack home">
            <Image
              alt=""
              className="brand-logo brand-logo--footer"
              height={354}
              src="/applypack-wordmark-transparent.png"
              width={992}
            />
          </Link>
          <p>{siteConfig.promise}</p>
          <a href={`mailto:${siteConfig.email.support}`}>{siteConfig.email.support}</a>
        </div>
        {groups.map((group) => (
          <nav aria-label={`${group.title} links`} key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {group.links.map(([href, label]) => (
                <li key={href}><Link href={href}>{label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="page-frame footer-bottom">
        <p>Copyright 2026 {siteConfig.legalEntity}. ApplyPack is a service of {siteConfig.legalEntity}.</p>
        <Link href="/get-started">Get My 10 Jobs in 24 Hours</Link>
      </div>
    </footer>
  );
}

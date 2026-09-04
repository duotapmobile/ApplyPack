import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/config/site";

const groups = [
  { title: "Service", links: [["/how-it-works", "How It Works"], ["/experience-connections", "How Matching Works"], ["/before-and-after", "Before and After"], ["/pricing", "Pricing"], ["/faq", "FAQ"]] },
  { title: "About", links: [["/why-apply-pack", "Why Apply Pack?"], ["/about", "About ApplyPack"], ["/contact", "Contact"], ["/accessibility", "Accessibility"]] },
  { title: "Legal", links: [["/privacy", "Privacy Policy"], ["/terms", "Terms of Service"]] },
] as const;

export function SiteFooter() {
  return <footer className="site-footer"><div className="page-frame footer-grid"><div className="footer-brand"><Link className="brand" href="/" aria-label="ApplyPack home"><Image alt="" className="brand-logo brand-logo--footer" height={1024} sizes="224px" src="/applypack-logo-high-res-source.png" width={1536} /></Link><p>{siteConfig.promise}</p><a href={`mailto:${siteConfig.email.support}`}>{siteConfig.email.support}</a></div>{groups.map((group) => <nav aria-label={`${group.title} links`} key={group.title}><h2>{group.title}</h2><ul>{group.links.map(([href, label]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul></nav>)}</div><div className="page-frame footer-bottom"><p>Copyright 2026 {siteConfig.legalEntity}. ApplyPack is a service of {siteConfig.legalEntity}.</p><Link href="/get-started">Find My 10 Jobs</Link></div></footer>;
}

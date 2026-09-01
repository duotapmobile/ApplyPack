"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { siteConfig } from "@/config/site";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab" && menuRef.current) {
        const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
      trigger?.focus();
    };
  }, [open]);

  return (
    <header className="site-header">
      <div className="page-frame header-inner">
        <Link className="brand" href="/" aria-label="ApplyPack home">
          <span className="brand-mark" aria-hidden="true">A</span>
          <span>ApplyPack</span>
        </Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {siteConfig.navigation.map((item) => (
            <Link href={item.href} key={item.href}>{item.label}</Link>
          ))}
        </nav>
        <div className="header-actions">
          <Link className="account-link" href="/my-applypack">My ApplyPack</Link>
          <Link className="header-cta" href="/get-started">Find My 10 Jobs</Link>
        </div>
        <button
          aria-controls="mobile-navigation"
          aria-expanded={open}
          aria-label="Open navigation"
          className="menu-trigger"
          onClick={() => setOpen(true)}
          ref={triggerRef}
          type="button"
        >
          <Menu aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <div className="mobile-menu" id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Navigation" ref={menuRef}>
          <div className="mobile-menu-top">
            <span className="brand">ApplyPack</span>
            <button aria-label="Close navigation" className="menu-trigger" onClick={() => setOpen(false)} ref={closeRef} type="button">
              <X aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Mobile navigation">
            {[...siteConfig.navigation, { href: "/about", label: "About" }, { href: "/contact", label: "Contact" }].map((item) => (
              <Link href={item.href} key={item.href} onClick={() => setOpen(false)}>{item.label}</Link>
            ))}
          </nav>
          <Link className="mobile-account" href="/my-applypack" onClick={() => setOpen(false)}>My ApplyPack</Link>
          <Link className="button-link button-link--primary" href="/get-started" onClick={() => setOpen(false)}>Find My 10 Jobs</Link>
        </div>
      ) : null}
    </header>
  );
}

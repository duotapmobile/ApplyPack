"use client";

import { useEffect } from "react";

/** Marks React's committed client shell, rather than merely server-rendered HTML. */
export function HydrationStatus() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
    return () => { delete document.documentElement.dataset.hydrated; };
  }, []);
  return null;
}

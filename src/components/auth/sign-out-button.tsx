"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button className="text-button" type="button" disabled={busy} onClick={async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out failed");
      router.push("/");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }}>{busy ? "Signing out..." : "Sign out"}</button>;
}

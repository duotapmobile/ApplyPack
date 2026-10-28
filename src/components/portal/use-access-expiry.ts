"use client";

import { useEffect, useState } from "react";
import { accessDeadlineExpired } from "@/lib/materials/retention-access";

export function useAccessExpiry(deadline: string | null | undefined, alreadyExpired = false) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const current = Date.now();
      setNow(current);
      clearTimeout(timer);
      const remaining = Date.parse(deadline) - current;
      if (remaining > 0) timer = setTimeout(refresh, Math.min(remaining + 1, 2_147_483_647));
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { clearTimeout(timer); window.removeEventListener("focus", refresh); };
  }, [deadline]);
  return alreadyExpired || accessDeadlineExpired(deadline, now);
}

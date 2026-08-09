"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function SiteVisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    void fetch("/api/visits", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isBackofficePath } from "@/lib/visitor-tracking";

export function SiteVisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || isBackofficePath(pathname)) return;

    void fetch("/api/visits", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}

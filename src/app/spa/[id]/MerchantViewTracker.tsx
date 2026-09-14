"use client";

import { useEffect, useRef } from "react";

export function MerchantViewTracker({ merchantId }: { merchantId: number }) {
  const recordedMerchantId = useRef<number | null>(null);

  useEffect(() => {
    if (recordedMerchantId.current === merchantId) return;
    recordedMerchantId.current = merchantId;

    void fetch(`/api/merchants/${merchantId}/view`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }, [merchantId]);

  return null;
}

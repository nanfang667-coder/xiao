"use client";

import { useEffect, useRef } from "react";

export function TeacherViewTracker({ teacherId }: { teacherId: number }) {
  const recordedTeacherId = useRef<number | null>(null);

  useEffect(() => {
    if (recordedTeacherId.current === teacherId) return;
    recordedTeacherId.current = teacherId;

    void fetch(`/api/teachers/${teacherId}/view`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }, [teacherId]);

  return null;
}

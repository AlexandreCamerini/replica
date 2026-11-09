"use client";

import { useEffect, useState } from "react";

/** "consultado há N min": calculado no navegador, porque a página é servida do cache (até 10 min). */
export function ConsultedAgo({ readAt, fallback }: { readAt: string; fallback: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <time dateTime={readAt}>{fallback}</time>;
  const min = Math.max(0, Math.floor((now - new Date(readAt).getTime()) / 60_000));
  const text = min < 60 ? `${min} min` : min < 24 * 60 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / (24 * 60))} d`;
  return <time dateTime={readAt} data-testid="consultado-ha">consultado há {text}</time>;
}

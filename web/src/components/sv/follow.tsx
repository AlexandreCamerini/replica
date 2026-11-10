"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FOLLOW_COOKIE, FOLLOW_MAX, parseFollows, serializeFollows } from "./follow-shared";

function read(): string[] {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${FOLLOW_COOKIE}=`));
  return parseFollows(m ? m.slice(FOLLOW_COOKIE.length + 1) : null);
}

function write(slugs: string[]) {
  const v = serializeFollows(slugs);
  document.cookie = v ? `${FOLLOW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax` : `${FOLLOW_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** Marca ou desmarca uma pessoa como "em quem eu votei". A lista fica só neste navegador. */
export function FollowButton({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const cur = read();
    setOn(cur.includes(slug));
    setFull(cur.length >= FOLLOW_MAX);
  }, [slug]);

  const toggle = () => {
    const cur = read();
    const next = cur.includes(slug) ? cur.filter((s) => s !== slug) : cur.length >= FOLLOW_MAX ? cur : [...cur, slug];
    write(next);
    setOn(next.includes(slug));
    setFull(next.length >= FOLLOW_MAX);
    router.refresh();
  };

  return (
    <>
      <button className="sv-follow" type="button" aria-pressed={on} onClick={toggle} disabled={!on && full}>
        {on ? "Você acompanha" : "Votei nesta pessoa: acompanhar"}
      </button>
      <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }} role="status">
        {on ? `${name} aparece em destaque na sua página inicial.` : full ? `Você já acompanha ${FOLLOW_MAX} pessoas, o limite. Tire alguém para incluir.` : "A lista fica guardada só neste navegador. Não criamos conta."}
      </p>
    </>
  );
}

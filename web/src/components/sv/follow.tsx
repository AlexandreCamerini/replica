"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { COOKIE_TEXTO } from "./prefs-shared";
import { FOLLOW_COOKIE, FOLLOW_MAX, FOLLOW_PATH, parseFollows, serializeFollows } from "./follow-shared";

function read(): string[] {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${FOLLOW_COOKIE}=`));
  return parseFollows(m ? m.slice(FOLLOW_COOKIE.length + 1) : null);
}

/**
 * Grava a lista em `path=/v2` (todos os leitores do cookie estão sob /v2: é opinião política, não vai para o resto do
 * site) e com `secure` em https (em http://localhost, sem: os e2e rodam assim). Antes, apaga a versão antiga gravada em
 * `path=/`, para não haver dois valores. Dívida registrada: gravar por server action com httpOnly.
 */
function write(slugs: string[]) {
  const v = serializeFollows(slugs);
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${FOLLOW_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
  document.cookie = v ? `${FOLLOW_COOKIE}=${v}; path=${FOLLOW_PATH}; max-age=31536000; samesite=lax${secure}` : `${FOLLOW_COOKIE}=; path=${FOLLOW_PATH}; max-age=0; samesite=lax${secure}`;
}

/** Marca ou desmarca uma pessoa como "em quem eu votei". A lista fica guardada num cookie neste navegador, e o servidor lê esse cookie. */
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
        {on ? `${name} aparece em destaque na sua página inicial.` : full ? `Você já acompanha ${FOLLOW_MAX} pessoas, o limite. Tire alguém para incluir.` : COOKIE_TEXTO}
      </p>
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// "Quem eu votei" fica só neste aparelho (localStorage). Nada vai para o servidor: a escolha de voto é dado sensível (LGPD).
const KEY = "quem-votei";
type Saved = { id: number; name: string; party: string; uf: string };

export function read(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return s && typeof s.id === "number" && typeof s.name === "string" ? s : null;
  } catch {
    return null;
  }
}

/** Botão de confirmar: guarda a escolha no aparelho e segue para o painel. */
export function Lembrar({ dep, href }: { dep: Saved; href: string }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(read()?.id === dep.id), [dep.id]);
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(dep));
      setSaved(true);
    } catch {}
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        href={href}
        onClick={save}
        className="inline-flex h-11 items-center border border-fg bg-surface-inverse px-4 text-sm font-semibold text-on-inverse outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {saved ? "Ver o painel" : "Confirmar e ver o painel"}
      </Link>
      <span className="text-sm text-muted">{saved ? "Guardado só neste aparelho." : "Fica guardado só neste aparelho. Nada vai para o servidor."}</span>
    </div>
  );
}

export function Esquecer() {
  const [has, setHas] = useState(false);
  useEffect(() => setHas(!!read()), []);
  if (!has) return null;
  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.removeItem(KEY);
        } catch {}
        setHas(false);
      }}
      className="inline-flex h-11 items-center px-1 text-sm text-muted underline underline-offset-2 hover:text-fg"
    >
      Esquecer neste aparelho
    </button>
  );
}

/** Na Entrada: se há escolha guardada, leva direto ao painel; senão, convida a escolher. */
export function AtalhoQuemVotei() {
  const [s, setS] = useState<Saved | null | undefined>(undefined);
  useEffect(() => setS(read()), []);
  if (s === undefined) return <span className="skeleton block h-11 w-56" aria-hidden />;
  return s ? (
    <Link href={`/quem-votei?uf=${s.uf}&dep=${s.id}`} className="inline-flex min-h-11 items-center border border-fg bg-surface px-4 text-sm font-semibold text-fg hover:bg-surface-sunken">
      Ver o painel de {s.name}
    </Link>
  ) : (
    <Link href="/quem-votei" className="inline-flex min-h-11 items-center border border-fg bg-surface-inverse px-4 text-sm font-semibold text-on-inverse">
      Escolher quem eu votei
    </Link>
  );
}

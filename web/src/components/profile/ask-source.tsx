import Link from "next/link";

/** Blocos que o formulário de sugestão sabe nomear (whitelist: `bloco` vem da URL). */
export const BLOCOS: Record<string, string> = {
  propostas: "propostas",
  votos: "votos em plenário",
  presenca: "presença",
  gastos: "gastos do gabinete",
  equipe: "equipe do gabinete",
  salario: "salário",
  camara: "site da câmara",
};

/**
 * Endereço base de /sugestoes para uma fonte que falta, com a pessoa e a cidade já preenchidas.
 * `cidade` só entra quando é um município (código IBGE de 7 dígitos). Quem chama acrescenta `&bloco=…`.
 */
export function askSourceHref(slug: string | undefined, cidade?: string | null) {
  const p = new URLSearchParams({ tipo: "fonte" });
  if (slug) p.set("p", slug);
  if (cidade && /^\d{7}$/.test(cidade)) p.set("cidade", cidade);
  return `/sugestoes?${p.toString()}`;
}

/** U02. Convite do estado vazio de um bloco sem fonte. */
export function AskSource({ href, bloco, casa = "a câmara" }: { href: string; bloco: keyof typeof BLOCOS; casa?: string }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg" data-testid="pedir-fonte">
      <span>Sabe onde {casa} publica?</span>
      <Link
        href={`${href}&bloco=${bloco}`}
        className="inline-flex min-h-11 items-center font-semibold text-fg underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Mande o endereço.
      </Link>
    </p>
  );
}

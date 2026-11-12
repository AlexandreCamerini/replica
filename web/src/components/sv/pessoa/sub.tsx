// Peças comuns das rotas da Pessoa no /v2 (gastos, equipe, votos). Server components, sem JS.
import Link from "next/link";
import { fmtInt } from "@/components/sv/fmt";
import type { ContextoPessoa } from "./contexto";

/** Cabeçalho de uma rota da Pessoa: volta à Pessoa (o link é o nome), título da rota, cargo e esfera em palavra. */
export function CabecalhoSub({ ctx, titulo, esfera }: { ctx: ContextoPessoa; titulo: string; esfera: string | null }) {
  const p = ctx.person;
  return (
    <div className="sv-cab">
      <p className="sv-vt sv-vt--sub">
        <span aria-hidden="true">←</span>&nbsp;Voltar a&nbsp;<Link href={`/v2/pessoa/${p.slug}`}>{p.displayName}</Link>
      </p>
      <h1>{titulo}</h1>
      {ctx.cargoLinha && <p className="sv-cab__c">{ctx.cargoLinha}</p>}
      {esfera && <p className="sv-cab__k">Esfera: {esfera}</p>}
    </div>
  );
}

/**
 * "Mostrando 51 a 100 de 345 notas" e links de página anterior e próxima (≥ 44 px), mantendo os filtros da URL.
 * `pagina` é 1-based; `por` é o tamanho da página. Nada aparece quando a lista cabe numa página.
 */
export function Paginacao({ base, params, pagina, por, total, nome, ordem }: { base: string; params: Record<string, string | null>; pagina: number; por: number; total: number; nome: { um: string; varios: string; fem?: boolean }; /** "da mais recente para a mais antiga" */ ordem: string }) {
  const ini = (pagina - 1) * por + 1;
  const fim = Math.min(total, pagina * por);
  const href = (n: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (n > 1) q.set("pagina", String(n));
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const ultima = Math.max(1, Math.ceil(total / por));
  return (
    <>
      <p className="sv-t">
        {total <= por
          ? `${fmtInt(total)} ${total === 1 ? nome.um : nome.varios}, ${ordem}.`
          : `Mostrando ${fmtInt(ini)} a ${fmtInt(fim)} de ${fmtInt(total)} ${nome.varios}, ${ordem}.`}
      </p>
      {total > por && (
        <nav className="sv-selo__l sv-pag" aria-label="Páginas">
          {pagina > 1 && <Link href={href(pagina - 1)}>Página anterior (mais recentes)</Link>}
          {pagina < ultima && <Link href={href(pagina + 1)}>Próxima página ({nome.fem ? "mais antigas" : "mais antigos"})</Link>}
          <span className="sv-pag__n">
            Página {fmtInt(pagina)} de {fmtInt(ultima)}
          </span>
        </nav>
      )}
    </>
  );
}

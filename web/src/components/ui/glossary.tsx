import Link from "next/link";
import { TERMS, slugify } from "@/content/dicionario";

/**
 * U05. Glossário recolhível no ponto de uso, sem JS: <details>/<summary> nativo (o leitor de tela anuncia expandido/recolhido).
 * O texto vem de TERMS, a mesma fonte de /dicionario: aqui não se copia definição nenhuma.
 * Termo que o dicionário não tem não é desenhado (ver GLOSS_MISSING).
 */
type Entry = { id: string; sigla: string; slug: string; test: RegExp };

// Cada sigla/palavra aponta para o verbete do dicionário. `test` roda sobre o texto da tela, sem acento e em minúsculas.
const ENTRIES: Entry[] = [
  { id: "pl", sigla: "PL", slug: slugify("Projeto de lei"), test: /\bpl\b|projeto de lei\b(?! complementar)/ },
  { id: "mpv", sigla: "MPV", slug: slugify("Medida provisória"), test: /\bmpv\b|medida provisoria/ },
  { id: "pec", sigla: "PEC", slug: slugify("Proposta de Emenda à Constituição (PEC)"), test: /\bpec\b|proposta de emenda a constituicao/ },
  { id: "relator", sigla: "Relator", slug: slugify("Relator"), test: /\brelatora?\b/ },
  { id: "destaque", sigla: "Destaque", slug: slugify("Destaque"), test: /\bdestaques?\b/ },
  { id: "emenda", sigla: "Emenda", slug: slugify("Emenda"), test: /(?<!proposta de )(?<!parlamentar )\bemendas?\b(?! parlamentar| a constituicao| constitucional)/ },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const bySlug = new Map(TERMS.map((t) => [t.slug, t]));

/** Termos do glossário que o dicionário não tem. Quem lê o relatório vê o que falta cadastrar. */
export const GLOSS_MISSING = ENTRIES.filter((e) => !bySlug.has(e.slug)).map((e) => e.sigla);

/** Quais termos aparecem nestes textos (ordem fixa do glossário, nunca por frequência). */
export function termsIn(texts: (string | null | undefined)[]): string[] {
  const all = fold(texts.filter(Boolean).join(" \n "));
  return ENTRIES.filter((e) => e.test.test(all) && bySlug.has(e.slug)).map((e) => e.id);
}

/**
 * Um bloco por tela, com um <details> por termo que aparece nos `texts`. `ids` força a lista (testes).
 * Cada termo aparece uma vez por chamada: é a "primeira ocorrência" da tela. `skip`: termos que outro bloco da mesma tela já explica.
 */
export function GlossaryFor({ texts, ids, skip, className = "" }: { texts?: (string | null | undefined)[]; ids?: string[]; skip?: string[]; className?: string }) {
  const found = (ids ?? termsIn(texts ?? [])).filter((id) => !skip?.includes(id));
  const items = ENTRIES.filter((e) => found.includes(e.id)).flatMap((e) => {
    const t = bySlug.get(e.slug);
    return t ? [{ e, t }] : [];
  });
  if (items.length === 0) return null;
  return (
    <div role="group" aria-label="Termos desta página" className={`flex flex-col ${className}`} data-testid="glossario">
      {items.map(({ e, t }) => (
        <details key={e.id} className="group border-t border-border first:border-t-0" data-termo={e.id}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-1.5 text-sm font-medium text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="grid size-5 shrink-0 place-items-center border border-fg font-mono text-xs leading-none group-open:hidden">+</span>
            <span aria-hidden className="hidden size-5 shrink-0 place-items-center border border-fg font-mono text-xs leading-none group-open:grid">−</span>
            <span>
              O que é <strong className="font-semibold">{e.sigla}</strong>?
            </span>
          </summary>
          <div className="pb-3 pl-7 text-sm text-fg">
            <p className="max-w-[65ch]">
              <strong className="font-semibold">{t.termo}.</strong> {t.def}
            </p>
            <p className="mt-1 text-xs text-muted">
              <Link href={`/dicionario#termo-${t.slug}`} className="underline underline-offset-2">
                Ver no dicionário
              </Link>
            </p>
          </div>
        </details>
      ))}
    </div>
  );
}

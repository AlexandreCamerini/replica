// F8 do roteiro do eleitor: glossário determinístico das leis citadas. Módulo puro.
// Cada verbete é escrito por pessoa e traz fonte e data de leitura; nenhum texto é gerado por agente. Lei fora do glossário = lacuna nomeada.

export type Verbete = { numero: string; titulo: string; resumo: string; fonte: string; url: string; lidoEm: string };

/** CONJUNTO AINDA VAZIO: os verbetes das 20 leis mais citadas na pauta só entram depois de conferidos contra a fonte oficial (Planalto). */
export const VERBETES: readonly Verbete[] = [];

/** Chave canônica de lei: "8213/1991" (sem pontos, sem "nº"). Aceita "Lei 8.213/91" e "Lei nº 8.213, de 24 de julho de 1991". */
export const chaveLei = (numero: string, ano: string): string => {
  const n = numero.replace(/\./g, "");
  const a = ano.length === 2 ? (Number(ano) > 30 ? `19${ano}` : `20${ano}`) : ano;
  return `${n}/${a}`;
};

export type LeiCitada = { chave: string; texto: string; tipo: "Lei" | "Lei Complementar" };

const PADRAO = /(?<![\wÀ-ÿ-])(Lei Complementar|Lei)\s+(?:n[º°o]\s*)?(\d{1,2}(?:\.\d{3})|\d{1,5})\s*(?:\/|,\s*de\s+(?:\d{1,2}º?\s+de\s+[a-zç]+\s+de\s+)?)(\d{4}|\d{2})\b/gi;

const DATA = String.raw`(\d{1,2}\.\d{3}|\d{1,5}),\s*de\s+\d{1,2}º?\s+de\s+[a-zç]+\s+de\s+(\d{4})`;
const PLURAL = new RegExp(String.raw`(?<![\wÀ-ÿ-])Leis\s+n[ºo°]s?\s+((?:${DATA}(?:,\s+e\s+|\s+e\s+|,\s*)?)+)`, "gi");

/** Leis citadas no texto, sem repetir, na ordem em que aparecem ("Lei 1/2000", "Leis nºs 1, de ..., e 2, de ..."). Decreto-Lei não é lei ordinária e fica de fora. */
export function leisCitadas(texto: string | null | undefined): LeiCitada[] {
  const t = texto ?? "";
  const achadas: { pos: number; chave: string; texto: string; tipo: LeiCitada["tipo"] }[] = [];
  for (const m of t.matchAll(PADRAO)) {
    const tipo = /complementar/i.test(m[1]) ? "Lei Complementar" : "Lei";
    achadas.push({ pos: m.index ?? 0, chave: `${tipo === "Lei" ? "" : "LC "}${chaveLei(m[2], m[3])}`, texto: m[0], tipo });
  }
  for (const m of t.matchAll(PLURAL)) {
    const base = m.index ?? 0;
    for (const x of m[1].matchAll(new RegExp(DATA, "gi"))) achadas.push({ pos: base + (x.index ?? 0), chave: chaveLei(x[1], x[2]), texto: `Lei nº ${x[1]}/${x[2]}`, tipo: "Lei" });
  }
  achadas.sort((a, b) => a.pos - b.pos);
  const vistos = new Set<string>();
  const out: LeiCitada[] = [];
  for (const a of achadas) {
    if (vistos.has(a.chave)) continue;
    vistos.add(a.chave);
    out.push({ chave: a.chave, texto: a.texto, tipo: a.tipo });
  }
  return out;
}

export type LeiNoGlossario = { citada: LeiCitada; verbete: Verbete | null };

/** Cada lei citada com o verbete, ou null quando o glossário não a tem (a tela mostra lacuna nomeada). */
export function noGlossario(texto: string | null | undefined, tabela: readonly Verbete[] = VERBETES): LeiNoGlossario[] {
  return leisCitadas(texto).map((citada) => ({ citada, verbete: tabela.find((v) => v.numero === citada.chave) ?? null }));
}

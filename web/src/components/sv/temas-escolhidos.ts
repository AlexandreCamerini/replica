// Assuntos escolhidos pelo leitor (F5 do roteiro do eleitor, B1: filtro por tema escolhido). Funções puras, sem Next: valem no servidor e em teste.
//
// O assunto é o tema oficial ligado à proposta votada (tabelas topics e proposal_topics: 17 temas fixos). O cookie guarda só slugs, no mesmo
// formato do cookie de escolhidos (sv_sigo): "saude.trabalho". É lido no servidor para montar a lista já filtrada, sem JavaScript. A escolha
// é interesse do leitor: fica neste navegador e só vai ao servidor no pedido da página (texto de cookie em COOKIE_TEXTO).
export const TEMAS_COOKIE = "sv_temas";
/** Mais que isto deixa de ser um filtro: o leitor escolhe poucos assuntos, e o limite mantém o cookie e a consulta pequenos. */
export const TEMAS_MAX = 5;
const SLUG = /^[a-z0-9-]{1,60}$/;

/**
 * Lê o cookie (ou a lista de campos do formulário). Descarta o que não é slug, repete ou, quando `validos` é dado, não existe na lista de
 * temas do contrato; corta em TEMAS_MAX. Nunca lança: cookie malformado vale como "nenhum assunto escolhido".
 */
export function parseTemas(raw: string | readonly string[] | null | undefined, validos?: readonly string[]): string[] {
  let partes: string[];
  if (Array.isArray(raw)) partes = raw.map(String);
  else {
    if (!raw) return [];
    let v: string;
    try {
      v = decodeURIComponent(raw as string);
    } catch {
      return [];
    }
    partes = v.split(".");
  }
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const p of partes) {
    const s = p.trim();
    if (!SLUG.test(s) || vistos.has(s) || (validos && !validos.includes(s))) continue;
    vistos.add(s);
    out.push(s);
    if (out.length >= TEMAS_MAX) break;
  }
  return out;
}

export const serializeTemas = (slugs: readonly string[]): string => parseTemas([...slugs]).join(".");

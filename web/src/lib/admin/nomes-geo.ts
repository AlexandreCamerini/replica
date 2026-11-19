import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Nome de município a partir das malhas do próprio site (web/public/geo/uf/NN.json), lidas do disco no servidor: sem rede, sem banco. Uma malha por UF, guardada em memória.
// Se o arquivo não estiver acessível (ex.: o ambiente de execução não leva `public/` junto), a função devolve `null` e a tela mostra o código IBGE, nunca quebra.

type Item = { ibge: string; name: string };
const malhas = new Map<string, Promise<Item[] | null>>();

function malhaDaUf(uf: string): Promise<Item[] | null> {
  let p = malhas.get(uf);
  if (!p) {
    p = readFile(path.join(process.cwd(), "public", "geo", "uf", `${uf}.json`), "utf8")
      .then((t) => {
        const j = JSON.parse(t) as { items?: Item[] };
        return Array.isArray(j.items) ? j.items : null;
      })
      .catch(() => null);
    malhas.set(uf, p);
  }
  return p;
}

/** ibge (7 dígitos) -> nome, só para os que a malha traz. */
export async function nomesDeMunicipios(ibges: readonly string[]): Promise<Map<string, string>> {
  const saida = new Map<string, string>();
  const porUf = new Map<string, string[]>();
  for (const i of new Set(ibges)) if (/^\d{7}$/.test(i)) (porUf.get(i.slice(0, 2)) ?? porUf.set(i.slice(0, 2), []).get(i.slice(0, 2))!).push(i);
  for (const [uf, lista] of porUf) {
    const itens = await malhaDaUf(uf);
    if (!itens) continue;
    for (const i of lista) {
      const achado = itens.find((x) => x.ibge === i);
      if (achado) saida.set(i, achado.name);
    }
  }
  return saida;
}

export async function nomeDeMunicipio(ibge: string): Promise<string | null> {
  return (await nomesDeMunicipios([ibge])).get(ibge) ?? null;
}

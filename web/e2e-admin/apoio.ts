// Apoio das specs da central (não é spec: o `testMatch` da configuração só pega *.spec.ts). Nenhuma URL absoluta: tudo relativo ao `baseURL` da configuração.
import { expect, type Locator, type Page } from "@playwright/test";
import { resolve } from "path";

export const LARGURAS = [1440, 390] as const;
export const PASTA_EVIDENCIAS = resolve(__dirname, "..", "..", "replica", "prompts", "evidencias");

/** Abre o mapa do país e espera a malha (do próprio site, /geo) carregar. */
export async function abrirMapaPais(page: Page, visao: "coleta" | "revisao" = "coleta"): Promise<Locator> {
  await page.goto(`/admin?visao=${visao}`);
  const mapa = page.getByRole("group", { name: "Brasil por estado" });
  await expect(mapa).toBeVisible();
  await expect(mapa.getByRole("link").first()).toBeVisible();
  return mapa;
}

/** Primeira UF do mapa com pelo menos uma ficha: devolve o nome acessível inteiro, a contagem e o href. */
export async function primeiraUfComFichas(page: Page): Promise<{ nome: string; total: number; href: string; ibge: string }> {
  const mapa = await abrirMapaPais(page);
  const links = mapa.getByRole("link");
  const n = await links.count();
  for (let i = 0; i < n; i++) {
    const nome = (await links.nth(i).getAttribute("aria-label")) ?? "";
    const m = /: (\d+) fichas?/.exec(nome);
    const href = (await links.nth(i).getAttribute("href")) ?? "";
    const ibge = /\/admin\/uf\/(\d{2})/.exec(href)?.[1];
    if (m && Number(m[1]) > 0 && ibge) return { nome, total: Number(m[1]), href, ibge };
  }
  throw new Error("Nenhuma UF com ficha no mapa: o banco não foi preparado pelo roteiro da primeira rodada (replica/prompts/evidencias/primeira-rodada.sh)?");
}

/** Primeira pendência da fila: devolve o href da ficha. */
export async function primeiraFichaDaFila(page: Page): Promise<string> {
  await page.goto("/admin/fila");
  const link = page.locator("[data-pendencia]").first().getByRole("link").first();
  await expect(link, "a fila não tem pendência: banco não preparado pela primeira rodada").toBeVisible();
  return (await link.getAttribute("href")) ?? "";
}

/** Falha a spec em erro de console da página ou resposta 5xx (mesmo critério do conjunto público, sem importá-lo). */
export function vigiarErros(page: Page): () => void {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) erros.push(`${r.status()} em ${new URL(r.url()).pathname}`);
  });
  return () => expect(erros, "erro de página / 5xx").toEqual([]);
}

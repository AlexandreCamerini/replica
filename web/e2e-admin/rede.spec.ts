// Critério 23: nenhuma requisição da central sai para host externo. Registra todo host diferente do servidor local; qualquer um reprova a spec.
import { expect, test } from "@playwright/test";
import { abrirMapaPais, primeiraFichaDaFila, primeiraUfComFichas } from "./apoio";

test("a central só fala com o próprio servidor (páginas, mapa, polling, ficha)", async ({ page, baseURL }) => {
  expect(baseURL, "baseURL vem da configuração").toBeTruthy();
  const local = new URL(baseURL!).host;
  const externos: string[] = [];
  const sockets: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol !== "http:" && u.protocol !== "https:") return; // data:, blob:, about: não saem da máquina
    if (u.host !== local) externos.push(`${r.method()} ${u.host}${u.pathname}`);
  });
  page.on("websocket", (w) => {
    if (new URL(w.url()).host !== local) sockets.push(w.url());
  });

  const uf = await primeiraUfComFichas(page);
  await abrirMapaPais(page, "revisao");
  await page.goto(`/admin/uf/${uf.ibge}`);
  await expect(page.getByRole("group", { name: /por município$/ })).toBeVisible();
  await page.goto(`/admin/registros?uf=${uf.ibge}`);
  await page.goto("/admin/rodadas");
  await page.goto(await primeiraFichaDaFila(page));
  await page.goto("/admin");
  await expect(page.getByRole("group", { name: "Brasil por estado" })).toBeVisible();
  await page.waitForTimeout(6_000); // deixa passar ao menos uma consulta periódica (intervalo de 5 s)
  await page.getByRole("link", { name: "Fila" }).first().click();
  await expect(page).toHaveURL(/\/admin\/fila/);

  expect(externos, "requisição para host fora do servidor local").toEqual([]);
  expect(sockets, "WebSocket para host externo").toEqual([]);
});

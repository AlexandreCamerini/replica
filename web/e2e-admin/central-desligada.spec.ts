// Critério 15: sem a variável que liga a central (este projeto sobe o `next start` SEM ADMIN_CENTRAL), toda rota dela responde 404.
// A outra metade do 15 (VERCEL/VERCEL_ENV definida mesmo com a central ligada) é provada sem navegador pela tarefa de provas (regra pura + curl).
import { expect, test } from "@playwright/test";

const PAGINAS = [
  "/admin",
  "/admin?visao=revisao",
  "/admin/uf/11",
  "/admin/registros",
  "/admin/registros?uf=11",
  "/admin/fila",
  "/admin/rodadas",
  "/admin/rodadas/00000000-0000-0000-0000-000000000000",
  "/admin/ficha/vinculo_sapl/qualquer",
];
const LEITURAS = ["/admin/api/estado", "/admin/api/fila", "/admin/api/relatorio/00000000-0000-0000-0000-000000000000", "/admin/api/ficha/vinculo_sapl/qualquer"];
const ESCRITAS = ["/admin/api/pedidos", "/admin/api/decisoes"];

test.describe("central desligada: 404 em toda rota", () => {
  for (const rota of PAGINAS) {
    test(`página ${rota}`, async ({ page }) => {
      const resp = await page.goto(rota);
      expect(resp?.status()).toBe(404);
    });
  }
  for (const rota of LEITURAS) {
    test(`GET ${rota}`, async ({ request }) => {
      expect((await request.get(rota)).status()).toBe(404);
    });
  }
  for (const rota of ESCRITAS) {
    test(`POST ${rota}`, async ({ request }) => {
      const r = await request.post(rota, { data: { tipo: "recoleta", parametros: {} }, headers: { "content-type": "application/json" } });
      expect(r.status()).toBe(404);
    });
  }
});

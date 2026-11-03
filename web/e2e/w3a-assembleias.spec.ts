import { expect, test } from "./fixtures";

// W3-A: deputados estaduais com dado da Assembleia (SP lida) e de UF não lida (BA). Dependem do banco real com `civico-etl ale.sp`.
const SP = "/p/barros-munhoz";
const BA = "/p/adolfo-menezes";

test.describe("W3-A · Assembleias no crachá", () => {
  test.skip(!process.env.E2E_PG, "precisa do banco real (E2E_PG=1)");

  test("W3A-H1 estadual de SP: propostas e verba com número, fonte e data; presença e votos \"—\" com motivo", async ({ page, axe }) => {
    await page.goto(SP);
    const sec = page.locator("#assembleia");
    await expect(sec.getByRole("heading", { level: 2 })).toHaveText("Na Assembleia Legislativa de São Paulo");
    await expect(sec.getByTestId("assembleia-itens")).toHaveAttribute("data-read", "1");
    // todo bloco tem fonte com data ou "conferido em" com a evidência
    for (const d of ["presenca", "votos", "propostas", "gastos_gabinete"]) {
      const it = sec.locator(`li[data-dataset=${d}]`);
      await expect(it.getByText(/Fonte:|conferido em/)).toBeVisible();
    }
    const props = sec.locator("li[data-dataset=propostas]");
    await expect(props).toHaveAttribute("data-status", "no_site");
    await expect(props.getByTestId("assembleia-valor")).toHaveText(/^\d[\d.]* como autor · \d[\d.]* como coautor$/);
    await expect(props.getByText(/atualizado em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    const verba = sec.locator("li[data-dataset=gastos_gabinete]");
    await expect(verba.getByTestId("assembleia-valor")).toHaveText(/^R\$\s?[\d.]+$/);
    for (const d of ["presenca", "votos"]) {
      const it = sec.locator(`li[data-dataset=${d}]`);
      await expect(it).toHaveAttribute("data-status", "nao_publica");
      await expect(it.getByTestId("assembleia-valor")).toHaveText("—");
      await expect(it).toContainText("A ALESP não publica em dado aberto");
    }
    // o número do bloco é o mesmo do cartão de cima (uma fonte só: person_period_stats)
    const tile = page.locator("section[aria-labelledby=numeros-h]");
    const autor = (await props.getByTestId("assembleia-valor").innerText()).split(" ")[0];
    await expect(tile.getByText(/^propostas desde/).locator("xpath=ancestor::div[1]/..")).toContainText(autor);
    // listas com o carimbo da casa, não o da Câmara
    await expect(page.locator("#propostas").getByText("Fonte:").locator("..")).toContainText("ALESP");
    await expect(page.locator("#gastos").getByRole("heading", { level: 2 })).toContainText("Verba de gabinete");
    await expect(page.locator("#gastos").getByText("Fonte:").locator("..")).toContainText("ALESP");
    // proposta sem situação na fonte não vira "Em tramitação"
    await expect(page.locator("#propostas")).not.toContainText("Em tramitação");
    // neutralidade: nada de nota, ranking ou cor por desempenho no bloco
    await expect(sec).not.toContainText(/ranking|nota|melhor|pior|posição/i);
    await axe();
  });

  test("W3A-H2 estadual de UF não lida (BA): tudo \"—\" com o motivo, nunca 0, sem lista de verba", async ({ page, axe }) => {
    await page.goto(BA);
    const sec = page.locator("#assembleia");
    await expect(sec.getByRole("heading", { level: 2 })).toHaveText("Na Assembleia Legislativa da Bahia");
    await expect(sec.getByTestId("assembleia-itens")).toHaveAttribute("data-read", "0");
    for (const d of ["presenca", "votos", "propostas", "gastos_gabinete"]) {
      const it = sec.locator(`li[data-dataset=${d}]`);
      await expect(it.getByTestId("assembleia-valor")).toHaveText("—");
      await expect(it).toContainText("A Assembleia Legislativa da Bahia ainda não é lida pelo site");
    }
    const tiles = page.locator("section[aria-labelledby=numeros-h]");
    for (const label of [/^propostas desde|^propostas na carreira/, /^gastos do gabinete/]) {
      const tile = tiles.getByText(label).locator("xpath=ancestor::div[2]");
      await expect(tile).toContainText("—");
      await expect(tile).not.toContainText(/^0$|R\$\s?0$/);
    }
    await expect(page.locator("#gastos")).toHaveCount(0);
    await expect(page.locator("#propostas")).toHaveCount(0);
    await axe();
  });

  test("W3A-H3 tema escuro sem violação do axe", async ({ page, axe }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(SP);
    await expect(page.locator("#assembleia")).toBeVisible();
    await axe();
  });

  test("W3A-H4 /dados-abertos e /atualizacoes mostram a ALESP como lida", async ({ page, axe }) => {
    await page.goto("/dados-abertos");
    const sec = page.getByTestId("assembleias");
    await expect(sec.locator("li[data-uf=SP] li[data-dataset=propostas]")).toHaveAttribute("data-status", "no_site");
    await expect(sec.getByTestId("assembleias-nao-lidas")).toContainText("Bahia");
    await expect(sec.getByTestId("assembleias-nao-lidas")).not.toContainText("São Paulo");
    await axe();
    await page.goto("/atualizacoes");
    await expect(page.locator("tr[data-source=alesp]")).toContainText("ALESP");
  });

  test("W3A-E1 390 px sem rolagem horizontal no crachá estadual @mobile", async ({ page }) => {
    for (const u of [SP, BA, "/dados-abertos"]) {
      await page.goto(u);
      await expect(page.locator("main")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), u).toBeLessThanOrEqual(390);
    }
  });
});

import { defineConfig, devices } from "@playwright/test";

// Specs ponta a ponta da central de administração de coleta (Parte C, critérios 15, 20, 21, 23, 26 e os estados de tela).
// Configuração PRÓPRIA: o conjunto público (`playwright.config.ts`, `e2e/`) não é tocado e não enxerga estas specs (critério 25).
// Não rodam no sandbox do agente (decisão AC-05): o dono roda fora dele, com o banco local da primeira rodada.
//
// Como rodar (de web/; o `next build` normal, sem a variável da central, é o mesmo do CI; a central lê o ambiente em tempo de execução):
//   1. banco preparado pelo roteiro da primeira rodada (recria `admin_coleta_r1`; precisa do Postgres local em localhost:54329):
//        bash ../replica/prompts/evidencias/primeira-rodada.sh
//      (o role `admin_central` com login local vem de `db/local/post_0003_admin_central.sql`, aplicado por `db/migrate.sh --local`)
//   2. build uma vez, numa pasta própria (não colide com o build do conjunto público):
//        NEXT_DIST_DIR=.next-admin npx next build
//   3. specs (ADMIN_DATABASE_URL: URL do role `admin_central` no banco local, host localhost/127.0.0.1/::1):
//        NEXT_DIST_DIR=.next-admin ADMIN_DATABASE_URL='postgres://admin_central:<senha local>@localhost:54329/admin_coleta_r1' \
//          npx playwright test -c playwright.admin.config.ts
//   As capturas do critério 26 saem em ../replica/prompts/evidencias/central-<visao>-<largura>.png.
//   Para o critério 21 de ponta a ponta (contagem muda em até 10 s) é preciso o executor rodando em outro terminal; estas specs não o sobem.

const URL_BANCO = process.env.ADMIN_DATABASE_URL;
if (!URL_BANCO || URL_BANCO.trim() === "") {
  throw new Error(
    "playwright.admin.config.ts: defina ADMIN_DATABASE_URL com a URL do role admin_central no banco local da primeira rodada " +
      "(ex.: postgres://admin_central:<senha local>@localhost:54329/admin_coleta_r1; host localhost, 127.0.0.1 ou ::1). Não há valor padrão.",
  );
}

// Portas próprias, diferentes da do conjunto público (3200).
const PORTA_LIGADA = 3310;
const PORTA_DESLIGADA = 3311;
const dist = process.env.NEXT_DIST_DIR || ".next-admin";

// Ambiente do servidor com a central desligada: herda o do processo, MENOS as variáveis da central (e nenhuma da Vercel).
const base: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) base[k] = v;
const semCentral = { ...base };
for (const k of ["ADMIN_CENTRAL", "ADMIN_DATABASE_URL", "VERCEL", "VERCEL_ENV"]) delete semCentral[k];

export default defineConfig({
  testDir: "./e2e-admin",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1, // as specs gravam pedidos no mesmo banco; em série
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-results-admin/relatorio" }]],
  outputDir: "test-results-admin",
  use: {
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "central",
      testIgnore: /central-desligada\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${PORTA_LIGADA}` },
    },
    {
      name: "central-desligada",
      testMatch: /central-desligada\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: `http://localhost:${PORTA_DESLIGADA}` },
    },
  ],
  webServer: [
    {
      command: `npx next start -p ${PORTA_LIGADA}`,
      url: `http://localhost:${PORTA_LIGADA}/admin`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...base, NEXT_DIST_DIR: dist, ADMIN_CENTRAL: "1", ADMIN_DATABASE_URL: URL_BANCO, NEXT_TELEMETRY_DISABLED: "1" },
    },
    {
      // sem ADMIN_CENTRAL: toda rota da central responde 404, então a prontidão é medida num arquivo estático do site (200), não numa rota da central
      command: `npx next start -p ${PORTA_DESLIGADA}`,
      url: `http://localhost:${PORTA_DESLIGADA}/favicon.ico`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...semCentral, NEXT_DIST_DIR: dist, NEXT_TELEMETRY_DISABLED: "1" },
    },
  ],
});

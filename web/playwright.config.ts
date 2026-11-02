import { defineConfig, devices } from "@playwright/test";

// E2E_BASE_URL aponta para um servidor já de pé (ex.: http://localhost:3101 com dados reais).
// Sem ela, sobe o dev server com os dados de demonstração (determinísticos) numa pasta .next própria.
const external = process.env.E2E_BASE_URL;
const port = 3200;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 2, // 3 workers contra um único `next start` passam de 15 s em navegações; flakiness, não bug
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: external ?? `http://localhost:${port}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, grep: /@mobile/ },
  ],
  // build de produção numa pasta própria: sem compilação sob demanda (fonte de hidratação inconsistente em dev) e sem colidir com o dev server
  webServer: external
    ? undefined
    : {
        command: `npx next build && npx next start -p ${port}`,
        url: `http://localhost:${port}/representantes`,
        reuseExistingServer: true,
        timeout: 300_000,
        env: { NEXT_DIST_DIR: ".next-e2e", DATA_SOURCE: "demo", ALLOW_DEMO_DATA: "1", NEXT_TELEMETRY_DISABLED: "1" },
      },
});

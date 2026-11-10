import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Sobe o servidor de verdade (processo filho, stdio) e fala MCP pelo cliente do SDK.
const root = fileURLToPath(new URL("..", import.meta.url));
const CPF = /\b\d{3}[.]?\d{3}[.]?\d{3}-?\d{2}\b/;
let client: Client;
const raw: string[] = [];

const ESPERADO: Record<string, string[]> = {
  buscar_politico: ["nome", "uf", "cargo", "pagina"],
  ver_politico: ["slug"],
  quem_me_representa: ["cidade", "uf"],
  como_votou: ["slug", "tema", "ano", "pagina", "limite"],
  comparar_votos: ["slug_a", "slug_b", "ano"],
  gastos_cota: ["slug", "ano"],
};

async function chamar(name: string, args: Record<string, unknown>) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0].text;
  raw.push(text);
  return { isError: Boolean(res.isError), json: JSON.parse(text) as Record<string, any> };
}

before(async () => {
  client = new Client({ name: "teste", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/stdio.ts"], cwd: root, stderr: "ignore" }));
});
after(async () => {
  await client.close();
});

describe("protocolo MCP (stdio)", () => {
  test("lista as 6 ferramentas, com schema de entrada não vazio e somente leitura", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(ESPERADO).sort());
    for (const t of tools) {
      assert.deepEqual(Object.keys(t.inputSchema.properties ?? {}).sort(), [...ESPERADO[t.name]].sort(), t.name);
      assert.ok(t.description && t.description.length < 300, `${t.name}: descrição curta`);
      assert.equal(t.annotations?.readOnlyHint, true, t.name);
    }
  });

  test("chama cada ferramenta e cada resposta traz fonte e atualizado_em", async () => {
    const chamadas: [string, Record<string, unknown>][] = [
      ["buscar_politico", { nome: "adriana ventura" }],
      ["ver_politico", { slug: "adriana-ventura" }],
      ["quem_me_representa", { cidade: "Campinas", uf: "SP" }],
      ["como_votou", { slug: "adriana-ventura", ano: 2025, limite: 3 }],
      ["comparar_votos", { slug_a: "adriana-ventura", slug_b: "acacio-favacho", ano: 2025 }],
      ["gastos_cota", { slug: "adriana-ventura", ano: 2025 }],
    ];
    for (const [n, a] of chamadas) {
      const r = await chamar(n, a);
      assert.equal(r.isError, false, `${n}: ${JSON.stringify(r.json).slice(0, 200)}`);
      assert.ok(r.json.fonte.length > 0 && r.json.fonte[0].url, `${n} fonte`);
      assert.match(r.json.atualizado_em, /^\d{4}-/, `${n} atualizado_em`);
    }
  });

  test("erro amigável com sugestões (slug, cidade) e validação de entrada", async () => {
    const a = await chamar("ver_politico", { slug: "adriana-ventur" });
    assert.equal(a.isError, true);
    assert.ok(a.json.sugestoes.length > 0);
    const b = await chamar("quem_me_representa", { cidade: "Campnas", uf: "SP" });
    assert.equal(b.isError, true);
    assert.ok(b.json.sugestoes.includes("Campinas"));
    const bad = await client.callTool({ name: "buscar_politico", arguments: { nome: "x", uf: "SPP" } });
    assert.equal(bad.isError, true);
    const badAno = await client.callTool({ name: "gastos_cota", arguments: { slug: "adriana-ventura", ano: "abc" } });
    assert.equal(badAno.isError, true);
  });

  test("nenhuma resposta traz CPF", () => {
    assert.ok(raw.length >= 6);
    for (const t of raw) assert.doesNotMatch(t, CPF);
  });
});

describe("protocolo MCP (HTTP em 127.0.0.1)", () => {
  test("lista ferramentas e chama uma", async () => {
    const { spawn } = await import("node:child_process");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const port = 3390 + Math.floor(Math.random() * 90);
    const child = spawn(process.execPath, ["--import", "tsx", "src/http.ts"], { cwd: root, env: { ...process.env, CIVICO_MCP_PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
    try {
      await new Promise<void>((ok, bad) => {
        child.stderr.on("data", (d) => String(d).includes("HTTP em") && ok());
        child.on("exit", () => bad(new Error("servidor HTTP caiu")));
        setTimeout(() => bad(new Error("timeout ao subir")), 15000);
      });
      const c = new Client({ name: "teste-http", version: "0" });
      await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      assert.equal((await c.listTools()).tools.length, 6);
      const res = await c.callTool({ name: "buscar_politico", arguments: { nome: "adriana ventura" } });
      assert.match((res.content as { text: string }[])[0].text, /adriana-ventura/);
      await c.close();
    } finally {
      child.kill();
    }
  });
});

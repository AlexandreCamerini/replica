import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Sql } from "./db.js";
import { OFFICE_SLUGS, ToolError, buscarPolitico, compararVotos, comoVotou, gastosCota, quemMeRepresenta, verPolitico, type Resposta } from "./tools.js";

const nome = z.string().trim().min(2).max(80);
const slug = z.string().trim().min(2).max(120).describe("slug do político (ex.: adriana-ventura); o nome também é aceito");
const uf = z.string().trim().length(2).transform((s) => s.toUpperCase()).refine((s) => /^[A-Z]{2}$/.test(s), "sigla de 2 letras");
const ano = z.number().int().min(2000).max(2100);
const pagina = z.number().int().min(1).max(1000).optional().describe("página, começando em 1");

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (r: Resposta): Out => ({ content: [{ type: "text", text: JSON.stringify(r, null, 1) }] });
const fail = (erro: string, sugestoes: unknown[] = []): Out => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ erro, ...(sugestoes.length ? { sugestoes } : {}) }, null, 1) }] });

async function run(f: () => Promise<Resposta>): Promise<Out> {
  try {
    return ok(await f());
  } catch (e) {
    if (e instanceof ToolError) return fail(e.message, e.sugestoes);
    const code = (e as { code?: string }).code;
    console.error("[civico-mcp]", e); // stderr: stdout é o protocolo
    if (code === "57014") return fail("A consulta passou do tempo limite. Restrinja o filtro (ano, tema) e tente de novo.");
    return fail("Não consegui consultar a base agora. Tente de novo em instantes.");
  }
}

export function createServer(sql: Sql): McpServer {
  const s = new McpServer({ name: "civico", version: "0.1.0" }, { instructions: "Dados públicos de políticos brasileiros, somente leitura, com fonte e data em cada resposta. Descreve; não avalia nem ranqueia. “—” significa não publicado (o motivo vem junto), nunca zero." });
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  s.registerTool("buscar_politico", {
    title: "Buscar político",
    description: "Acha políticos com mandato atual pelo nome (sem acento ou maiúscula). Devolve slug, nome, cargo, partido e UF, em ordem A–Z.",
    inputSchema: { nome, uf: uf.optional(), cargo: z.enum(OFFICE_SLUGS).optional(), pagina },
    annotations: ro,
  }, (a) => run(() => buscarPolitico(sql, a)));

  s.registerTool("ver_politico", {
    title: "Ver crachá de um político",
    description: "Resumo do crachá: mandatos, salário (teto ou pago, e diz qual), patrimônio por eleição, presença (com a regra), propostas, votos e cota do ano; cada número com fonte e data, ou “—” com o motivo.",
    inputSchema: { slug },
    annotations: ro,
  }, (a) => run(() => verPolitico(sql, a)));

  s.registerTool("quem_me_representa", {
    title: "Quem me representa",
    description: "Representantes em exercício de uma cidade, por nível: cidade (prefeitura e vereadores), estado e Brasília (presidência, Senado, Câmara).",
    inputSchema: { cidade: nome, uf },
    annotations: ro,
  }, (a) => run(() => quemMeRepresenta(sql, a)));

  s.registerTool("como_votou", {
    title: "Como votou",
    description: "Votos nominais de uma pessoa, do mais recente ao mais antigo, com tema, voto, resultado e placar. Filtros: tema (slug) e ano.",
    inputSchema: { slug, tema: z.string().trim().min(2).max(40).optional().describe("slug do tema, ex.: saude, educacao"), ano: ano.optional(), pagina, limite: z.number().int().min(1).max(50).optional() },
    annotations: ro,
  }, (a) => run(() => comoVotou(sql, a)));

  s.registerTool("comparar_votos", {
    title: "Comparar votos",
    description: "Percentual de votos iguais entre duas pessoas nas votações nominais em comum e as 10 divergências mais recentes. Mede coincidência, não qualidade.",
    inputSchema: { slug_a: slug, slug_b: slug, ano: ano.optional() },
    annotations: ro,
  }, (a) => run(() => compararVotos(sql, a)));

  s.registerTool("gastos_cota", {
    title: "Gastos da cota parlamentar",
    description: "Cota parlamentar de um ano: total, por categoria (A–Z) e os 10 maiores fornecedores pessoa jurídica (em ordem alfabética). Pessoa física nunca é listada.",
    inputSchema: { slug, ano },
    annotations: ro,
  }, (a) => run(() => gastosCota(sql, a)));

  return s;
}

#!/usr/bin/env node
import { createServer as createHttp } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { assertReadOnly, connect } from "./db.js";
import { createServer } from "./server.js";

// Streamable HTTP sem sessão, só em 127.0.0.1 (uso local). Não há autenticação: não exponha esta porta na rede.
const port = Number(process.env.CIVICO_MCP_PORT ?? 3333);
const sql = connect();
await assertReadOnly(sql);

const http = createHttp(async (req, res) => {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ erro: "use /mcp" }));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST", "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Método não permitido (servidor sem sessão)" }, id: null }));
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64_000) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(c as Buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "JSON inválido" }, id: null }));
    return;
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createServer(sql);
  res.on("close", () => void transport.close().then(() => server.close()));
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
});
http.listen(port, "127.0.0.1", () => console.error(`[civico-mcp] HTTP em http://127.0.0.1:${port}/mcp (somente leitura)`));
const bye = () => void sql.end({ timeout: 2 }).finally(() => process.exit(0));
process.on("SIGINT", bye);
process.on("SIGTERM", bye);

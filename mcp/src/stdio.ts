#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { assertReadOnly, connect } from "./db.js";
import { createServer } from "./server.js";

const sql = connect();
try {
  await assertReadOnly(sql);
} catch (e) {
  console.error("[civico-mcp] não consegui abrir a base somente leitura:", (e as Error).message);
  process.exit(1);
}
await createServer(sql).connect(new StdioServerTransport());
console.error("[civico-mcp] pronto (stdio, somente leitura)");
const bye = () => void sql.end({ timeout: 2 }).finally(() => process.exit(0));
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
process.stdin.on("close", bye);

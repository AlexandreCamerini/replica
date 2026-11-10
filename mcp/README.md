# civico-mcp · servidor MCP somente leitura

Deixa um assistente de IA (Claude Desktop, Claude Code ou qualquer cliente MCP) consultar as mesmas fontes públicas do site: mandatos, salário, patrimônio declarado, presença, propostas, votos e cota parlamentar. Descreve; não avalia nem ranqueia ninguém.

Stack: TypeScript + `@modelcontextprotocol/sdk` (zod valida a entrada) + `postgres`. Transporte padrão: stdio. HTTP (opcional) só em `127.0.0.1`.

## Pré-requisitos

- Node 20+ (testado em 24).
- Postgres do projeto no ar, com a role `web_reader` (leitura). Local: `postgres://web_reader:web_reader@localhost:54329/civico`.

```bash
cd mcp
npm install
npm run build        # gera dist/
npm test             # 31 testes contra o banco local (unidade + protocolo stdio + HTTP)
```

## Variáveis

| Variável | Padrão | Para quê |
|---|---|---|
| `CIVICO_DATABASE_URL` | URL local acima | conexão; o usuário **precisa** ser `web_reader` (senão o servidor não sobe) |
| `CIVICO_QUERY_TIMEOUT_MS` | `8000` | `statement_timeout` de cada consulta |
| `CIVICO_MCP_PORT` | `3333` | só no modo HTTP |

## Plugar no Claude Code

```bash
claude mcp add civico -e CIVICO_DATABASE_URL=postgres://web_reader:web_reader@localhost:54329/civico -- node /CAMINHO/ATÉ/replica/mcp/dist/stdio.js
claude mcp list        # civico deve aparecer como conectado
```

## Plugar no Claude Desktop

Em `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), dentro de `mcpServers`:

```json
{
  "mcpServers": {
    "civico": {
      "command": "node",
      "args": ["/CAMINHO/ATÉ/replica/mcp/dist/stdio.js"],
      "env": { "CIVICO_DATABASE_URL": "postgres://web_reader:web_reader@localhost:54329/civico" }
    }
  }
}
```

Reinicie o app. Sem build: troque `command`/`args` por `npx` + `["tsx", "/CAMINHO/…/mcp/src/stdio.ts"]`.

## HTTP (opcional, local)

```bash
npm run start:http     # http://127.0.0.1:3333/mcp, sem sessão, sem autenticação
claude mcp add --transport http civico http://127.0.0.1:3333/mcp
```

Não há autenticação: não exponha a porta na rede. Hospedagem pública é outra decisão (exige deploy, limite de uso e autenticação) e não está feita.

## Ferramentas

| Ferramenta | Entrada | Devolve |
|---|---|---|
| `buscar_politico` | `nome`, `uf?`, `cargo?`, `pagina?` | slug, nome, cargo, partido, UF (A–Z; mandatos atuais) |
| `ver_politico` | `slug` | mandatos; salário (teto **ou** pago, dizendo qual); patrimônio por eleição; presença com a regra; propostas; votos; cota do ano. Cada número com fonte e data, ou “—” com o motivo |
| `quem_me_representa` | `cidade`, `uf` | representantes em exercício: cidade, estado, Brasília |
| `como_votou` | `slug`, `tema?`, `ano?`, `pagina?`, `limite?` | votos nominais recentes: data, descrição, tema, voto, resultado, placar |
| `comparar_votos` | `slug_a`, `slug_b`, `ano?` | % de votos iguais nas votações em comum e até 10 divergências recentes |
| `gastos_cota` | `slug`, `ano` | total, categorias (A–Z) e 10 maiores fornecedores pessoa jurídica (listados A–Z) |

`cargo` aceita: `presidente`, `vice_presidente`, `senador`, `deputado_federal`, `governador`, `vice_governador`, `deputado_estadual`, `deputado_distrital`, `prefeito`, `vice_prefeito`, `vereador`.

## Regras

- Somente leitura em três camadas: role `web_reader` (a URL é conferida antes de conectar), sessão com `default_transaction_read_only = on` e verificação no início (`current_user`, `transaction_read_only`). Nenhuma ferramenta escreve.
- Consultas parametrizadas, `statement_timeout` por consulta, no máximo 3 conexões, listas limitadas (página de até 50; representantes até 200 por cargo, acima do maior grupo real).
- Toda resposta traz `fonte` (nome e URL) e `atualizado_em` (carimbo da carga mais antiga entre os números da resposta; no salário, a data de vigência).
- Neutralidade: ordem A–Z ou por data. A única seleção por valor é “10 maiores fornecedores” da cota, que é de fornecedor e sai em ordem alfabética.
- Ausente é “—” com motivo, nunca zero (Senado sem presença, Executivo sem plenário, dado ainda não carregado).
- Privacidade: sem CPF, endereço ou doador pessoa física. Fornecedor só se CNPJ (14 dígitos); nome com cara de CPF (MEI) fica fora da lista.
- Erros amigáveis: slug, cidade, UF ou tema inexistente devolvem `erro` e `sugestoes`.
- stdout é o protocolo: logs vão para stderr.

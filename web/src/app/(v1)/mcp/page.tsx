import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/page/code-block";
import { Container, PageHeader } from "@/components/page/page-header";

export const metadata: Metadata = {
  title: "Assistente (MCP)",
  description: "Pergunte ao seu assistente de IA sobre políticos e deixe que ele consulte as mesmas fontes públicas do site, em modo somente leitura.",
};

const link = "font-semibold text-accent-text underline underline-offset-2";

const TOOLS = [
  { name: "buscar_politico", args: "nome, uf?, cargo?", does: "Acha quem tem mandato atual pelo nome. Devolve slug, nome, cargo, partido e UF, em ordem alfabética.", ask: "“Quem é a deputada Adriana Ventura?”" },
  { name: "ver_politico", args: "slug", does: "O resumo do crachá: mandatos, salário (diz se é o teto ou o valor pago), patrimônio declarado por eleição, presença com a regra de contagem, propostas, votos e a cota do ano.", ask: "“Mostre o crachá de adriana-ventura.”" },
  { name: "quem_me_representa", args: "cidade, uf", does: "Os representantes em exercício de uma cidade, por nível: a cidade, o estado e Brasília.", ask: "“Quem me representa em Campinas, SP?”" },
  { name: "como_votou", args: "slug, tema?, ano?", does: "Votos nominais, do mais recente ao mais antigo, com tema, voto, resultado e placar.", ask: "“Como ela votou em saúde em 2025?”" },
  { name: "comparar_votos", args: "slug_a, slug_b, ano?", does: "Em quantas votações nominais em comum os dois votaram igual, e as divergências mais recentes. Mede coincidência, não qualidade.", ask: "“Compare os votos de dois deputados em 2025.”" },
  { name: "gastos_cota", args: "slug, ano", does: "A cota parlamentar de um ano: total, categorias e os dez maiores fornecedores pessoa jurídica, em ordem alfabética.", ask: "“Em que ela gastou a cota em 2025?”" },
];

const CLAUDE_CODE = `cd mcp && npm install && npm run build
claude mcp add civico \\
  -e CIVICO_DATABASE_URL=postgres://web_reader:web_reader@localhost:54329/civico \\
  -- node /CAMINHO/ATÉ/replica/mcp/dist/stdio.js`;

const DESKTOP = `{
  "mcpServers": {
    "civico": {
      "command": "node",
      "args": ["/CAMINHO/ATÉ/replica/mcp/dist/stdio.js"],
      "env": {
        "CIVICO_DATABASE_URL": "postgres://web_reader:web_reader@localhost:54329/civico"
      }
    }
  }
}`;

export default function Page() {
  return (
    <Container>
      <PageHeader
        title="Consulte pelo seu assistente de IA"
        lead="Um servidor MCP deixa o Claude (ou outro assistente compatível) buscar políticos, votos e gastos nas mesmas fontes oficiais do site, sem copiar e colar."
      />

      <div className="flex max-w-[68ch] flex-col gap-8">
        <section aria-labelledby="o-que-e" className="flex flex-col gap-2">
          <h2 id="o-que-e" className="font-display text-2xl text-fg">
            O que é
          </h2>
          <p className="text-base text-fg">
            MCP é um padrão para ligar assistentes de IA a fontes de dados. Instalado, o seu assistente ganha seis ferramentas de consulta. Você
            pergunta em português (“quem me representa em Campinas?”), ele chama a ferramenta certa e responde com o que o banco do site tem.
          </p>
          <p className="text-base text-fg">
            O servidor lê o mesmo banco que alimenta as páginas daqui. Cada resposta traz a fonte oficial e a data da carga; o que a fonte não
            publica vem como “—” e o motivo, nunca como zero.
          </p>
        </section>

        <section aria-labelledby="regras" className="flex flex-col gap-2">
          <h2 id="regras" className="font-display text-2xl text-fg">
            O que ele garante
          </h2>
          <ul className="ml-5 flex list-disc flex-col gap-1 text-base text-fg">
            <li>Somente leitura: usa uma conta do banco que só consulta, e a sessão recusa qualquer escrita.</li>
            <li>Descreve e não avalia: nenhuma ferramenta dá nota, ranking ou veredito sobre uma pessoa. As listas saem em ordem alfabética ou por data.</li>
            <li>Sem CPF, sem endereço e sem doador pessoa física. Fornecedor só aparece se for empresa (CNPJ).</li>
            <li>Limite de linhas por resposta e tempo máximo por consulta; erro de nome ou cidade volta com sugestões.</li>
          </ul>
          <p className="text-sm text-muted">
            As regras de contagem (presença, o traço no lugar do zero, neutralidade) são as de{" "}
            <Link href="/sobre" className={link}>
              Metodologia e fontes
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="ferramentas" className="flex flex-col gap-3">
          <h2 id="ferramentas" className="font-display text-2xl text-fg">
            As seis ferramentas
          </h2>
          <ul className="flex flex-col gap-3">
            {TOOLS.map((t) => (
              <li key={t.name} data-tool={t.name} className="rounded-sm border border-border bg-surface p-3">
                <p className="font-mono text-base font-semibold text-fg [overflow-wrap:anywhere]">
                  {t.name}
                  <span className="font-normal text-muted">({t.args})</span>
                </p>
                <p className="mt-1 text-sm text-fg">{t.does}</p>
                <p className="mt-1 text-sm text-muted">Exemplo de pergunta: {t.ask}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="instalar" className="flex flex-col gap-3">
          <h2 id="instalar" className="font-display text-2xl text-fg">
            Como instalar
          </h2>
          <p className="text-base text-fg">
            Hoje o servidor roda na sua máquina, apontando para o banco do projeto. Ainda não existe um endereço público para conectar de fora:
            hospedar o servidor depende de deploy e de uma decisão do responsável pelo site. Precisa de Node 20 ou mais novo e do código do
            repositório (pasta <code className="font-mono text-sm">mcp/</code>).
          </p>
          <CodeBlock label="Claude Code">{CLAUDE_CODE}</CodeBlock>
          <p className="text-base text-fg">
            No Claude Desktop, abra o arquivo <code className="font-mono text-sm [overflow-wrap:anywhere]">claude_desktop_config.json</code> (no Mac:
            Library/Application Support/Claude), acrescente o bloco abaixo e reinicie o aplicativo.
          </p>
          <CodeBlock label="Claude Desktop">{DESKTOP}</CodeBlock>
          <p className="text-sm text-muted">
            Troque <code className="font-mono">/CAMINHO/ATÉ</code> pelo caminho real. O servidor só aceita a conta de leitura{" "}
            <code className="font-mono">web_reader</code>; com outra conta ele não sobe. O passo a passo completo, as variáveis e o modo HTTP
            local estão em <code className="font-mono">mcp/README.md</code>.
          </p>
        </section>

        <p className="text-sm text-muted">
          Prefere ver no navegador?{" "}
          <Link href="/representantes" className={link}>
            Achar quem representa a sua cidade
          </Link>{" "}
          ou{" "}
          <Link href="/dados-abertos" className={link}>
            ver quem publica dados e o que ainda falta
          </Link>
          .
        </p>
      </div>
    </Container>
  );
}

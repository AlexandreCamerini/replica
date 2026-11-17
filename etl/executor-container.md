# Executor da central em container

Worker contínuo de `civico-etl admin executor` (F5 de `replica/reavaliacao-central-e-dominio.md`, seções 2.4 e 6). A imagem é agnóstica de provedor: qualquer host que rode uma imagem OCI com variáveis de ambiente e reinício automático serve. A escolha do host é do dono.

## Construir

```sh
docker build -f etl/Dockerfile etl          # contexto = etl/ (a partir da raiz do repositório)
```

- Base `python:3.12-slim` (o `pyproject.toml` pede `>=3.12`); dependências de `etl/uv.lock` com `uv sync --frozen --no-dev --no-editable`. O `uv` vem da imagem `ghcr.io/astral-sh/uv` na versão do argumento `UV_VERSION`.
- Dois estágios: o runtime só leva o venv; sem compilador, sem `uv`, sem testes. Usuário `etl` (uid 10001), não root.
- Nenhum segredo na imagem. `.dockerignore` exclui `.env*`, `.cache`, `.raw`, `admin-rodadas`, `tests`, venvs.
- Comando padrão: `civico-etl admin executor --intervalo 2`. Os argumentos do `docker run` depois do nome da imagem substituem o `CMD` (ex.: `admin executor --uma-vez`).

## Rodar

```sh
docker run -d --restart=always --name executor-central \
  -e ETL_DATABASE_URL \
  <imagem>
```

`-e NOME` sem valor repassa a variável do ambiente de quem executa o comando; no host escolhido, cadastre o valor no cofre de segredos do próprio provedor.

Variáveis lidas pelo código do executor (nomes; nenhum valor neste arquivo):

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `ETL_DATABASE_URL` | sim | Conexão do ETL com escrita (`db.connect`; cai em `DATABASE_URL` se ela faltar). Não é a URL do `admin_central`, que só insere pedidos. Sem ela o processo sai com erro de configuração. |
| `ETL_CACHE_DIR` | não | Cache HTTP das rodadas. A imagem já define `/data/cache`; o log de tentativas vai ao lado, em `/data/admin-rodadas`. |
| `ADMIN_RODADA_TIMEOUT_S` | não | Limite, em segundos, do subprocesso de cada rodada; estourar = rodada interrompida. Sem ele não há limite. |
| `ADMIN_COLETA_AGENTES` | não | Uma das duas chaves do `aplicar` por agentes (`on` liga). Deixe ausente a menos que o dono decida ligar. |
| `ETL_LOG` | não | Nível de log (padrão `INFO`). |
| `ETL_CODE_VERSION`, `ETL_INVOCATION` | não | Rótulos gravados em `ingest_runs` (versão do código e identificador da chamada). |
| `ETL_RATE_LIMIT` | não | Limite de taxa das leituras HTTP, lido pelo cliente HTTP dos coletores. |
| `ETL_RAW_STORE` e `ETL_RAW_*` | não | Cópia do bruto (desligada por padrão; `local`, `supabase` ou `r2`). Só ligue com a credencial do backend escolhido. |

Coletores de rodada que dependem de chave própria (por exemplo `TRANSPARENCIA_*`) leem o ambiente do subprocesso: só entram se o dono as cadastrar. O pedido de parecer usa o motor de ensaio local e não lê a chave da API do modelo; não passe `ANTHROPIC_API_KEY` a este container.

## Política de reinício e encerramento

- Reinício: sempre (`--restart=always`, `restart: always`, ou o equivalente do host). O executor é sem estado; o estado vive no banco.
- Encerramento: o `ENTRYPOINT` está em forma exec, então o `civico-etl` é o PID 1 e recebe o SIGTERM do orquestrador. O laço para de pegar pedido; se há pedido em execução, o batimento para, o pedido vira `interrompido` com o motivo "executor encerrado (SIGTERM)" e o processo sai com código 0. Sem pedido em execução, sai na hora. A tela não espera os 120 s do órfão.
- Configure o prazo de parada do host (`docker stop -t`, `terminationGracePeriod`, etc.) em pelo menos 15 s. Morte por SIGKILL, falta de memória ou perda do host não passa pelo tratador: nesse caso vale o limite de 120 s sem batimento, e o próximo executor (ou o reinício) limpa o órfão e recupera a rodada ligada.
- Pedido interrompido não retoma sozinho: a rodada é retomável por "Repetir" na central ou por `rodada executar`.

## Recursos mínimos

Sem medição em produção (INCERTO); ponto de partida: 1 vCPU compartilhada, 512 MB de RAM (rodadas com `duckdb` e PDFs podem pedir 1 GB), 1 GB de disco para `/data` (cache; volume é opcional, sem ele o cache se perde no reinício e a rodada relê as fontes). Saída para a internet em HTTPS e acesso TCP ao Postgres do ETL. Não precisa de porta de entrada.

## Ver o batimento pela tela

O executor grava `batimento_em` do pedido em execução a cada 15 s. A central lê isso em `estado_dos_pedidos` e marca "executor parado" quando há pedido `na_fila` há mais de 60 s ou `em_execucao` sem batimento há mais de 120 s; com batimento em dia, mostra "ocupado". O texto "executor visto há X" ainda não existe na tela: hoje há só `executor_parado`/`executor_ok` (`web/src/lib/admin/estado-tela.ts`). Trocá-lo é item de web da F5, fora desta tarefa. Pelo banco: `select status, batimento_em from adm_pedidos where status = 'em_execucao'`.

## Reserva por GitHub Actions (só descrita; nenhum workflow foi criado)

Se o container cair, um workflow agendado de hora em hora (`cron: "7 * * * *"`) pode checar a fila e drenar com `civico-etl admin executor --uma-vez` repetido até esvaziar. Pontos a decidir ao criá-lo:

- Latência: no mínimo 5 min e já houve atraso de 85 min (`etl.yml`). É reserva, não substituto: a tela fica em "executor parado" nesse intervalo.
- Segredo `ETL_DATABASE_URL` no repositório, como o `etl.yml`; mesma instalação do CI (`uv sync --frozen`).
- Rodar só se o batimento estiver vencido ou se houver pedido `na_fila` velho, para não competir com o container vivo (dois executores não pegam o mesmo pedido, `for update skip locked`, mas disputam a trava da rodada).
- Usar o mesmo grupo de `concurrency` do `etl.yml` (`group: etl`) evita sobrepor o `run-due`.

## Concorrência com o `run-due`

Rodada da central e `run-due` no mesmo dataset não corrompem (cada um tem a sua trava), mas um dos dois falha com "outro run em andamento" (seção 2.4). O container não tem a janela do `run-due` embutida: o `run-due` roda a cada 3 h, com disparos extras às 00:31 e 05:01 BRT, de ter a sáb (`etl.yml`). Decisão pendente do dono: (a) a central evita rodadas nessas janelas; ou (b) o `run-due` tolera a falha e repõe na chamada seguinte (a reposição de janela, D318, já cobre o caso). Até decidir, o pedido que bater na trava termina `falhou` com o motivo, e a repetição resolve.

## O que o dono decide

- Host, região e plano (nenhum é recomendado aqui) e se o volume `/data` existe.
- Credencial: a URL de escrita do ETL vai para outro host, ampliando a superfície; use um papel dedicado de menor privilégio se possível e rotacione.
- Rede: IP de datacenter pode ser bloqueado por portais SAPL (INCERTO). Teste uma rodada pequena (um estado) antes de confiar; se bloquear, o plano B é o Mac do dono, hoje usado para o `sapl.todas`.
- Política da concorrência com o `run-due` (acima) e se a reserva por Actions é criada.
- Se `ADMIN_COLETA_AGENTES` fica ligada (padrão: não).

## Verificação feita nesta entrega

`docker` está instalado no sandbox, mas o daemon não responde, então a imagem NÃO foi construída. O que foi checado: `uv sync --frozen --no-dev --no-editable --dry-run` resolve a partir do `uv.lock` sem rede; teste de sinal em `etl/tests/test_admin_executor_sinal.py` (subprocesso real, SIGTERM e SIGINT). Primeiro build real: `docker build -f etl/Dockerfile etl` e, com o banco local, `docker run --rm -e ETL_DATABASE_URL <imagem> admin executor --uma-vez`.

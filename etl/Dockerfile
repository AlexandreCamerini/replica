# Executor de pedidos da central (`civico-etl admin executor`) como worker contínuo. Agnóstico de provedor.
# Build:  docker build -f etl/Dockerfile etl        (contexto = etl/; ver etl/executor-container.md)
# Nenhum segredo entra na imagem: ETL_DATABASE_URL e demais variáveis vêm do ambiente do container, em tempo de execução.

ARG PYTHON_VERSION=3.12
ARG UV_VERSION=0.13.1

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# ---- estágio 1: dependências e pacote, a partir do uv.lock (sem dev) ----
FROM python:${PYTHON_VERSION}-slim AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /src
# camada das dependências: só muda se pyproject.toml ou uv.lock mudarem
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-editable
# o pacote (o `.dockerignore` deixa de fora testes, caches, rodadas e .env*)
COPY civico_etl ./civico_etl
RUN uv sync --frozen --no-dev --no-editable

# ---- estágio 2: runtime enxuto, usuário não root ----
FROM python:${PYTHON_VERSION}-slim AS runtime
# tini: init como PID 1 (colhe zumbis e repassa SIGTERM/SIGINT ao civico-etl); vem do repositório da distribuição
RUN apt-get update && apt-get install -y --no-install-recommends tini \
 && apt-get clean && find /var/lib/apt/lists -type f -delete \
 && groupadd --system --gid 10001 etl \
 && useradd --system --uid 10001 --gid etl --home-dir /home/etl --create-home --shell /usr/sbin/nologin etl \
 && mkdir -p /data/cache && chown -R etl:etl /data
COPY --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ETL_CACHE_DIR=/data/cache
# /data/cache é o cache HTTP das rodadas; `admin-rodadas` (log de tentativas) fica ao lado, em /data/admin-rodadas.
# Volume é opcional: sem ele o cache se perde no reinício e a rodada refaz as leituras.
WORKDIR /data
USER etl
# tini é o PID 1 (colhe netos órfãos dos subprocessos da rodada) e repassa o SIGTERM ao executor: ele marca o pedido em execução como `interrompido` e sai com 0.
ENTRYPOINT ["tini", "--", "civico-etl"]
CMD ["admin", "executor", "--intervalo", "2"]

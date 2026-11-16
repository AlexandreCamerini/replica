"""FABRICADO. Roda a CLI REAL do civico-etl sobre respostas fabricadas do SAPL (etl/tests/fixtures/sapl_ale/<cenario>), sem rede.

Uso (a partir de etl/):
  ETL_DATABASE_URL=postgres://.../banco_local uv run --frozen python tests/simulado.py --cenario v1 [--cache-dir DIR] [--tolerante] -- <argv da CLI>
  ex.:  -- sapl.ales --workers 1        -- admin inventario --json

Contrato:
- a PRIMEIRA linha de stdout e de stderr é `SIMULADO: respostas fabricadas de etl/tests/fixtures/sapl_ale/<cenario> (nenhuma requisição de rede)`;
- recusa (código 2, antes de importar o coletor e de conectar) se ETL_DATABASE_URL faltar, se o host do banco não for local (localhost, 127.0.0.1, ::1
  ou socket Unix) ou se o banco se chamar `civico`;
- define ADMIN_RUNNER=processo (o executor de administração roda o coletor neste processo, onde o transporte fabricado está instalado) e ETL_RAW_STORE=off
  se não estiver definida; o cache de HTTP fica em --cache-dir (padrão: diretório temporário novo);
- chama civico_etl.cli.main(argv) e sai com o código dele; URL fora do mapa: sem --tolerante, sai com 3 no fim (os jobs engolem o AssertionError do
  transporte, por isso a checagem é no fim); com --tolerante, a URL responde 404 e a execução segue;
- no fim, em stderr: quantas URLs foram pedidas e quantas não estavam previstas.
Cenários e URLs: etl/tests/fixtures/sapl_ale/LEIA-ME.md.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

AQUI = Path(__file__).resolve().parent
LOCAIS = {"localhost", "127.0.0.1", "::1"}


def banner(cenario: str) -> str:
    return f"SIMULADO: respostas fabricadas de etl/tests/fixtures/sapl_ale/{cenario} (nenhuma requisição de rede)"


def recusa_banco(url: str | None) -> str | None:
    """Motivo da recusa, ou None se o banco é aceitável. Só olha a URL; não conecta."""
    if not url:
        return "ETL_DATABASE_URL não está definida; o lançador só roda contra banco local explícito"
    p = urlparse(url)
    host = p.hostname
    if host is None:  # sem host na autoridade: socket Unix; ?host=... pode nomear o diretório do socket ou um host de rede
        host = (parse_qs(p.query).get("host") or [""])[0]
    local = host == "" or host.startswith("/") or host in LOCAIS
    if not local:
        return f"host do banco `{host}` não é local (localhost, 127.0.0.1, ::1 ou socket); recusado"
    nome = p.path.lstrip("/")
    if nome == "civico":
        return "o banco se chama `civico`; recusado (use um banco de teste)"
    if not nome:
        return "a URL não nomeia um banco; recusado"
    return None


def main(argv: list[str]) -> int:
    if "--" in argv:
        i = argv.index("--")
        proprio, cli_argv = argv[:i], argv[i + 1:]
    else:
        proprio, cli_argv = argv, []
    ap = argparse.ArgumentParser(prog="simulado.py", description="CLI real sobre respostas fabricadas do SAPL (sem rede). Argumentos da CLI vêm depois de `--`.")
    ap.add_argument("--cenario", required=True, choices=["v1", "v2", "falhas"])
    ap.add_argument("--cache-dir", help="cache de HTTP (padrão: diretório temporário novo)")
    ap.add_argument("--tolerante", action="store_true", help="URL não prevista responde 404 em vez de derrubar a execução com código 3")
    a = ap.parse_args(proprio)
    linha = banner(a.cenario)
    print(linha, flush=True)
    print(linha, file=sys.stderr, flush=True)
    if not cli_argv:
        print("simulado.py: falta o comando da CLI depois de `--`", file=sys.stderr)
        return 2
    motivo = recusa_banco(os.environ.get("ETL_DATABASE_URL"))
    if motivo:
        print(f"simulado.py: recusado: {motivo}", file=sys.stderr)
        return 2
    os.environ["ADMIN_RUNNER"] = "processo"
    os.environ["ADMIN_SIMULADO"] = a.cenario  # a rodada grava a marca em previa.resultado.simulado; o relatório a lê de lá
    os.environ.setdefault("ETL_RAW_STORE", "off")
    sys.path.insert(0, str(AQUI))
    from admin_fixtures import instalar

    cache = a.cache_dir or tempfile.mkdtemp(prefix="simulado-cache-")
    t = instalar(None, a.cenario, cache, estrito=not a.tolerante)
    from civico_etl import cli

    try:
        rc = int(cli.main(cli_argv))
    except SystemExit as e:  # o que o interpretador faria num processo real
        if isinstance(e.code, int):
            rc = e.code
        elif e.code is None:
            rc = 0
        else:
            print(e.code, file=sys.stderr)
            rc = 1
    finally:
        t.desfazer()
    print(f"SIMULADO: {len(t.pedidos)} URLs pedidas, {len(t.nao_previstos)} não previstas", file=sys.stderr, flush=True)
    if t.nao_previstos:
        for u in dict.fromkeys(t.nao_previstos):
            print(f"SIMULADO: não prevista no mapa: {u}", file=sys.stderr)
        if not a.tolerante:
            print("SIMULADO: URL fora do mapa; saída 3 (use --tolerante para responder 404 e seguir)", file=sys.stderr)
            return 3
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

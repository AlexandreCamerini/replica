"""FABRICADO. Critério 12 (B2): "Uma consulta real de quem consome a base devolve o valor novo."

Para as Assembleias, o leitor é `getAssembly` em `web/src/lib/data/pg.ts`. Esse módulo importa `server-only` e não roda fora do Next, então este teste copia o SQL de
`getAssembly` (comentário em `SQL_ASSEMBLEIA_CASA` e `SQL_ASSEMBLEIA_COBERTURA` com arquivo e linhas de origem) e o executa pelo psycopg, no banco isolado, antes e depois de
aplicar uma decisão sobre campos que essa consulta lê. Um teste confere que o trecho copiado ainda bate com o arquivo (normalizando espaços): se o site mudar a consulta, ele quebra.

`listSourceStatus` não serve (lê só `sources` e `dataset_stamps`) e `getCoverage` só cobre município. Sem rede; nada é gravado no banco da suíte (contagens antes/depois); tudo roda
numa transação do banco isolado que reverte.
"""

from __future__ import annotations

import re
from pathlib import Path

import psycopg
import pytest
from banco_isolado import REPO, banco_isolado  # noqa: F401  (fixture de sessão; não vive no conftest)
from conftest import database_url
from psycopg.rows import dict_row
from test_admin_decisoes import POR, _dns_de_teste, n, um  # noqa: F401  (_dns_de_teste é autouse: o DNS falso do anti-SSRF de `decidir`, sem rede)
from test_admin_propostas import AGORA, H, P, iso, m  # noqa: F401  (fixtures iso e m)
from test_admin_vinculos import IBGE

from civico_etl.admin import aplicar as APL
from civico_etl.admin import decisoes as DEC
from civico_etl.admin import propostas as PR

PG_TS = REPO / "web" / "src" / "lib" / "data" / "pg.ts"

# Copiado de web/src/lib/data/pg.ts, método `getAssembly`, linhas 432-438 (a casa e o carimbo da carga). `${uf.toUpperCase()}` virou o parâmetro %s (valor: a sigla em maiúsculas).
SQL_ASSEMBLEIA_CASA = """
      select b.adapter, b.place_id, coalesce(s.slug, case when b.adapter = 'sapl' then 'sapl-ale' end) as slug,
             coalesce(s.name, case when b.adapter = 'sapl' then 'SAPL da Assembleia Legislativa' end) as source_name,
             coalesce(s.url, b.open_data_url) as source_url, h.loaded_at as sapl_loaded_at
      from legislative_bodies b join places p on p.id = b.place_id
      left join sources s on b.adapter = 'ale_custom' and s.url = b.open_data_url
      left join sapl_houses h on b.adapter = 'sapl' and h.place_id = b.place_id and h.status = 'ok'
      where p.kind = 'uf' and p.uf = %s and b.kind in ('assembleia', 'camara_legislativa_df') limit 1"""

# Copiado de web/src/lib/data/pg.ts, método `getAssembly`, linha 442 (a cobertura dos quatro datasets). `${b.place_id as string}` virou %s (o place_id lido pela consulta acima).
SQL_ASSEMBLEIA_COBERTURA = """select dataset, status, reason, evidence_url, checked_on from data_coverage where place_id = %s::uuid and dataset in ('presenca', 'votos', 'propostas', 'gastos_gabinete')"""

TS_PARAMETROS = ("${uf.toUpperCase()}", "${b.place_id as string}")  # o que cada `%s` substitui, na ordem em que aparecem nas duas consultas


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _suite() -> dict[str, int]:
    with psycopg.connect(database_url(), row_factory=dict_row, autocommit=True) as c:
        return {t: c.execute(f"select count(*) as n from {t}").fetchone()["n"] for t in ("sapl_houses", "data_coverage", "adm_decisoes", "adm_overrides", "corrections", "legislative_bodies")}  # noqa: S608


@pytest.fixture(scope="module", autouse=True)
def suite_intacta():
    antes = _suite()
    yield
    assert _suite() == antes, "o banco da suíte mudou"


# ------------------------------------------------------------------ a cópia bate com o arquivo


def _sql_do_arquivo() -> tuple[str, str]:
    """Extrai de pg.ts, dentro de `getAssembly`, o SQL das duas consultas (template do driver `postgres`), com os `${...}` trocados por %s."""
    ts = PG_TS.read_text(encoding="utf-8")
    ini = ts.index("async getAssembly(uf)")
    fim = ts.index("async getCityCouncil", ini)
    corpo = ts[ini:fim]
    consultas = re.findall(r"await sql`(.*?)`", corpo, flags=re.S)
    cobertura = [c for c in consultas if "from data_coverage" in c]
    casa = [c for c in consultas if "from legislative_bodies b" in c]
    assert len(casa) == 1 and len(cobertura) == 1, "getAssembly mudou de forma: reexamine a cópia do SQL"
    params = [re.sub(r"\$\{(.*?)\}", "%s", c) for c in (casa[0], cobertura[0])]
    assert [m_ for c in (casa[0], cobertura[0]) for m_ in re.findall(r"\$\{.*?\}", c)] == list(TS_PARAMETROS)
    return params[0], params[1]


def test_o_sql_copiado_ainda_bate_com_o_arquivo_do_site():
    casa, cobertura = _sql_do_arquivo()
    assert _norm(casa) == _norm(SQL_ASSEMBLEIA_CASA), "a consulta da casa em getAssembly mudou; atualize a cópia (e o comentário de linhas) deste teste"
    assert _norm(cobertura).replace("::uuid", "::uuid") == _norm(SQL_ASSEMBLEIA_COBERTURA)
    linhas = PG_TS.read_text(encoding="utf-8").splitlines()
    assert "select b.adapter, b.place_id" in linhas[431] and "limit 1`;" in linhas[437] and "from data_coverage where place_id" in linhas[441]  # as linhas citadas (1-based 432, 438, 442)


# ------------------------------------------------------------------ a consulta do site devolve o valor novo


def le_assembleia(c, uf: str) -> dict:
    """O que `getAssembly` lê do banco para a UF: a casa (com o carimbo da carga) e a cobertura dos quatro datasets."""
    b = c.execute(SQL_ASSEMBLEIA_CASA, (uf.upper(),)).fetchone()
    assert b is not None, f"sem casa legislativa para {uf}"
    cob = {r["dataset"]: r for r in c.execute(SQL_ASSEMBLEIA_COBERTURA, (str(b["place_id"]),)).fetchall()}
    return {"casa": b, "cobertura": cob}


@pytest.fixture
def ro(iso, m):
    """A Assembleia de RO lida pelo SAPL (adapter 'sapl', carga feita) e a cobertura dos quatro datasets, como o banco real as teria depois de `sapl.ales`."""
    iso.execute("update legislative_bodies set adapter = 'sapl' where id = %s", (m["b_ale"],))
    iso.execute("update sapl_houses set loaded_at = %s where id = %s", (AGORA, m["h_ale"]))
    for ds in ("presenca", "votos", "propostas", "gastos_gabinete"):
        iso.execute("insert into data_coverage (place_id, dataset, status, reason, evidence_url, checked_on) values (%s, %s, 'carregando', %s, %s, '2026-11-01')",
                    (m["ro"], ds, f"{ds} lidos do SAPL da Assembleia (carga automática)", f"https://sapl.al.teste.example/{ds}"))
    return m


def test_getassembly_devolve_o_valor_novo_da_cobertura_depois_de_aplicar_a_decisao(iso, ro):
    antes = le_assembleia(iso, "ro")
    assert antes["cobertura"]["propostas"]["reason"] == "propostas lidos do SAPL da Assembleia (carga automática)"
    for campo, cand in (("reason", "a página da Assembleia mostra as propostas só em PDF; conferido à mão"), ("status", "so_portal"), ("evidence_url", "https://al.teste.example/propostas-pdf")):
        pid = PR.registrar(iso, P(ro, classe="cobertura", registro_chave="11:propostas", campo=campo, valor_candidato=cand, conteudo_sha256=H(f"l-{campo}"),
                                  url="https://al.teste.example/fonte"), agora=AGORA).pendencia_id
        APL.aplicar(iso, DEC.decidir(iso, pid, acao="aprovar", **POR)["id"])
    depois = le_assembleia(iso, "ro")
    d = depois["cobertura"]["propostas"]
    assert (d["status"], d["reason"], d["evidence_url"]) == ("so_portal", "a página da Assembleia mostra as propostas só em PDF; conferido à mão", "https://al.teste.example/propostas-pdf")
    assert (d["status"], d["reason"], d["evidence_url"]) != (antes["cobertura"]["propostas"]["status"], antes["cobertura"]["propostas"]["reason"], antes["cobertura"]["propostas"]["evidence_url"])
    for ds in ("presenca", "votos", "gastos_gabinete"):  # os outros datasets da UF não mudaram
        assert depois["cobertura"][ds] == antes["cobertura"][ds]
    assert depois["casa"] == antes["casa"]  # a casa e o carimbo da carga, idem


def test_getassembly_devolve_o_valor_novo_do_status_da_casa_pelo_join_com_sapl_houses(iso, ro):
    """`getAssembly` junta `sapl_houses` com `h.status = 'ok'` e lê `h.loaded_at`: decidir outro status faz o carimbo da carga sumir da consulta (a Assembleia deixa de contar como lida pelo SAPL)."""
    antes = le_assembleia(iso, "ro")
    assert antes["casa"]["adapter"] == "sapl" and antes["casa"]["sapl_loaded_at"] == AGORA
    pid = PR.registrar(iso, P(ro, registro_chave=str(ro["h_ale"]), campo="status", valor_candidato="fora_do_ar", conteudo_sha256=H("l-st"), url="https://al.teste.example/api/"), agora=AGORA).pendencia_id
    r = APL.aplicar(iso, DEC.decidir(iso, pid, acao="aprovar", **POR)["id"])
    depois = le_assembleia(iso, "ro")
    assert depois["casa"]["sapl_loaded_at"] is None and depois["casa"]["adapter"] == "sapl"
    assert um(iso, "select status from sapl_houses where id = %s", ro["h_ale"])["status"] == "fora_do_ar"
    assert r["corrections"]["gravou"] is True and any("getAssembly" in x for x in r["corrections"]["leitores"])  # o campo tem leitor no site: vira `corrections`


# ------------------------------------------------------------------ campo -> leitor no site


def _leitores_no_site(padrao: str) -> set[str]:
    """Métodos (ou funções) de pg.ts, fora de comentário, que têm linha casando com `padrao`."""
    out: set[str] = set()
    atual = None
    for linha in PG_TS.read_text(encoding="utf-8").splitlines():
        mm = re.match(r"^  async (\w+)\(", linha) or re.match(r"^(?:async )?function (\w+)\(", linha) or re.match(r"^async function (\w+)\(", linha)
        if mm:
            atual = mm.group(1)
        if linha.lstrip().startswith(("//", "*", "/*")):
            continue
        if re.search(padrao, linha) and atual:
            out.add(atual)
    return out


def _metodo_da_linha(numero: int) -> str:
    atual = None
    for i, linha in enumerate(PG_TS.read_text(encoding="utf-8").splitlines(), 1):
        mm = re.match(r"^  async (\w+)\(", linha) or re.match(r"^(?:async )?function (\w+)\(", linha)
        if mm:
            atual = mm.group(1)
        if i == numero:
            return atual or ""
    raise AssertionError(numero)


def test_tabela_campo_leitor_confere_com_o_site():
    # campo (tabela.coluna) -> padrão que o SQL do site usa para lê-lo -> métodos esperados. Conferido em web/src/lib/data/pg.ts.
    tabela = {
        "sapl_houses.status": (r"\bh\.status\b", {"getCouncilSite", "getAssembly", "getCityCouncil", "getPeopleCoverage"}),
        "sapl_houses.base_url": (r"\bh\.base_url\b", {"getCouncilSite", "getCityCouncil", "getPeopleCoverage"}),
        "data_coverage.status|reason|evidence_url": (r"from data_coverage", {"getCoverage", "getAssembly", "getCoverageMatrix", "getPeopleCoverage", "statsForPeople"}),
        "mandate_contacts.value": (r"from mandate_contacts", {"getContacts"}),
        "identity_match_queue.status": (r"identity_match_queue", set()),  # sem leitor no site
        "person_external_ids": (r"person_external_ids", set()),  # sem leitor no site: a decisão de identidade não gera `corrections`
        "corrections": (r"\bcorrections\b", set()),  # a tabela pública não tem leitor em pg.ts: `listCorrections` lê answer_drafts
    }
    for campo, (padrao, esperado) in tabela.items():
        assert _leitores_no_site(padrao) == esperado, (campo, _leitores_no_site(padrao))
    # o que `getAssembly` lê de sapl_houses é só `status` (no join) e `loaded_at`: NÃO lê base_url
    casa, cobertura = _sql_do_arquivo()
    assert "base_url" not in casa and "base_url" not in cobertura and "h.status = 'ok'" in casa and "h.loaded_at" in casa
    assert "getAssembly" not in _leitores_no_site(r"\bh\.base_url\b")
    # cada entrada da constante de leitores aponta para o método que realmente está naquela linha
    for lista in APL.LEITORES.values():
        for l in lista:
            assert _metodo_da_linha(l["linha"]) == l["metodo"], l
    # e a constante é a MESMA lista do grep, por tabela (a constante não pode ficar para trás do site)
    def metodos(*chaves):
        return {l["metodo"] for k in chaves for l in APL.LEITORES[k]}

    assert metodos(("vinculo_sapl", "status")) == _leitores_no_site(r"\bh\.status\b")
    assert metodos(("vinculo_sapl", "base_url")) == _leitores_no_site(r"\bh\.base_url\b")
    assert metodos(("cobertura", "status"), ("cobertura", "reason"), ("cobertura", "evidence_url")) == _leitores_no_site(r"from data_coverage")
    assert metodos(("contato_mandato", "contato")) == _leitores_no_site(r"from mandate_contacts")
    assert ("identidade", "status") not in APL.LEITORES  # sem leitor no site


def test_base_url_de_assembleia_nao_tem_leitor_em_getassembly_e_a_decisao_nao_toca_sapl_houses(iso, ro):
    """`sapl_houses.base_url` de Assembleia: `getAssembly` não a lê (afirmado acima, sobre o SQL copiado), e por isso a consulta do critério 12 não a mostra. O site a lê em outros
    métodos (`getCityCouncil`, `getPeopleCoverage`: link da fonte no crachá). Mesmo assim a aplicação de uma decisão de `base_url` de Assembleia NÃO muda `sapl_houses`
    (o endereço sondado é o do código), então o valor que o site lê não muda e não há `corrections`."""
    ha = str(ro["h_ale"])
    antes_casa = dict(um(iso, "select * from sapl_houses where id = %s", ha))
    antes_site = le_assembleia(iso, "ro")
    pid = PR.registrar(iso, P(ro, registro_chave=ha, campo="base_url", valor_candidato="https://sapl.al.novo.example", conteudo_sha256=H("l-bu"), url="https://al.teste.example/x"), agora=AGORA).pendencia_id
    r = APL.aplicar(iso, DEC.decidir(iso, pid, acao="aprovar", **POR)["id"])
    assert dict(um(iso, "select * from sapl_houses where id = %s", ha)) == antes_casa and le_assembleia(iso, "ro") == antes_site
    assert r["corrections"]["gravou"] is False and n(iso, "corrections") == 0 and n(iso, "adm_overrides") == 0
    assert um(iso, "select url from adm_vinculos where registro_chave = %s and origem = 'correcao_manual' and vigente", ha)["url"] == "https://sapl.al.novo.example"


def test_cobertura_de_municipio_tem_leitor_em_getcoverage(iso, m):
    """`getCoverage` (pg.ts:412) só cobre município e filtra `status <> 'no_site'`; o SQL é o do site, executado pelo psycopg."""
    linhas = PG_TS.read_text(encoding="utf-8").splitlines()
    assert "select dataset, status, reason, evidence_url, checked_on from data_coverage dc join places p on p.id = dc.place_id where p.ibge_code = " in linhas[411]
    sql = "select dataset, status, reason, evidence_url, checked_on from data_coverage dc join places p on p.id = dc.place_id where p.ibge_code = %s and dc.status <> 'no_site' order by dataset"
    antes = {r["dataset"]: r for r in iso.execute(sql, (IBGE,)).fetchall()}
    pid = PR.registrar(iso, P(m, classe="cobertura", registro_chave=f"{IBGE}:propostas", campo="reason", valor_candidato="motivo conferido", conteudo_sha256=H("gc"), url="https://c.example/x"), agora=AGORA).pendencia_id
    APL.aplicar(iso, DEC.decidir(iso, pid, acao="aprovar", **POR)["id"])
    depois = {r["dataset"]: r for r in iso.execute(sql, (IBGE,)).fetchall()}
    assert antes["propostas"]["reason"] == "teste" and depois["propostas"]["reason"] == "motivo conferido" and depois["contato"] == antes["contato"]

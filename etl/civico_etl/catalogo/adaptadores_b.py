"""Adaptadores do lote B (R8b): um por coletor, registrados em `contrato.ADAPTADORES` pelo decorador `adaptador`.

Cada adaptador devolve o `Plano` (comando, argv, urls, estimativa, observacao, nao_suportado) que `contrato.descrever` espera. O argv é exatamente o que a
CLI aceita hoje para o recorte; não leva `--force` nem `--limit` por conta própria. Nenhum adaptador usa rede; `conn` (opcional) só lê o banco.
Importar este módulo registra os sete adaptadores e não importa nenhum job nem a CLI.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from .coletores_b import (
    CAM_API, SEN_API, URL_AGENDA_CAMARA, URL_AGENDA_SENADO_MES, URL_PAUTA_CAMARA, URL_PAUTA_SENADO_COMISSOES, URL_PAUTA_SENADO_MES, URL_SEN_CEAPS,
    URL_SEN_LISTA_ATUAL, URL_SEN_VOTACAO_ANO, URL_SEN_VOTACAO_JANELA,
)
from .contrato import BRT, Plano, Recorte, _anos_flags, _expandir, _juntar, adaptador
from .modelo import Coletor

_JANELA_NOTURNA_DIAS = 3  # senado_diario.py:216 (days=3)
_JANELA_PAUTA_DIAS = 14  # pauta.py:35 (WINDOW_DAYS)
_PRIMEIRO_ANO_SECRETAS = 2019  # cli.py:205 (range(2019, ano+1))
_INICIO_LEGISLATURA = {56: date(2019, 2, 1), 57: date(2023, 2, 1), 58: date(2027, 2, 1)}  # camara_presenca.py:36 (LEG_START)


def _sub(modelo: str, **valores: str) -> str:
    for chave, valor in valores.items():
        modelo = modelo.replace("{" + chave + "}", valor)
    return modelo


def _unicas(urls: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(urls))


def _nota_reprocessar(r: Recorte, texto: str) -> str:
    return texto if r.modo == "reprocessar" else ""


# ---------------------------------------------------------------- senado.diario


@adaptador("senado.diario")
def _senado_diario(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # cli.py:201: run_senado(conn, years=a.year or [ano-1, ano], limit=a.limit, force=a.force); o CEAPS usa os mesmos anos (senado_diario.py:213)
    dia = hoje or date.today()
    anos = list(r.anos) or [dia.year - 1, dia.year]
    urls = [URL_SEN_LISTA_ATUAL]
    urls += [_sub(URL_SEN_VOTACAO_ANO, ano=str(a), fim=min(date(a, 12, 31), dia).isoformat()) for a in anos]  # senado_diario.py:244
    urls += [_sub(URL_SEN_CEAPS, ano=str(a)) for a in anos]
    partes = [
        "" if r.anos else f"anos padrão da CLI ({anos}), pela data {dia}",
        c.entradas.depende_de,
    ]
    if conn is not None:
        rows = conn.execute(
            """select distinct e.external_id from person_external_ids e
               join sources s on s.id = e.source_id and s.slug = 'senado'
               join mandates m on m.person_id = e.person_id
               join offices o on o.id = m.office_id and o.slug = 'senador'
               where m.status = 'em_exercicio' order by e.external_id""").fetchall()
        cods = [str(x["external_id"]) for x in rows]
        for cod in cods:
            urls += [f"{SEN_API}/senador/{cod}.json", f"{SEN_API}/senador/{cod}/filiacoes.json", f"{SEN_API}/senador/{cod}/autorias.json"]
        partes.append(f"{len(cods)} senadores com mandato em exercício no banco (3 URLs por senador); a lista atual da API é quem manda na hora da execução")
    partes.append(_nota_reprocessar(r, "reprocessar: mesmo argv de recoletar; só o CEAPS pula por checksum, o resto regrava; sem --force (não decidido aqui)"))
    return "senado.diario", ["senado.diario", *_anos_flags(r.anos)], _unicas(urls), True, _juntar(*partes), ""


# ---------------------------------------------------------------- senado.noturna


@adaptador("senado.noturna")
def _senado_noturna(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # run_senado_noturna(conn, force): since = hoje(BRT) - 3 dias; um ano por ano de since e de hoje (senado_diario.py:225-230); dataFim = min(31/12, date.today()) (:244)
    dia = hoje or datetime.now(BRT).date()
    since = dia - timedelta(days=_JANELA_NOTURNA_DIAS)
    anos = sorted({since.year, dia.year})
    urls = [_sub(URL_SEN_VOTACAO_JANELA, inicio=max(since, date(a, 1, 1)).isoformat(), fim=min(date(a, 12, 31), dia).isoformat()) for a in anos]
    obs = _juntar(
        f"anos {anos} e datas derivados da data de execução ({dia}, Brasília) e da janela de {_JANELA_NOTURNA_DIAS} dias; outra data de execução muda as URLs",
        "o job usa date.today() (fuso do servidor) no dataFim e a data de Brasília no resto; aqui as duas são `hoje`",
        _nota_reprocessar(r, "reprocessar: mesmo argv de recoletar; o run não leva checksum, sempre regrava"),
    )
    return "senado.noturna", ["senado.noturna"], _unicas(urls), False, obs, ""


# ---------------------------------------------------------------- senado.secretas


@adaptador("senado.secretas")
def _senado_secretas(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # cli.py:205: run_secretas(conn, years=a.year or range(2019, ano+1), force=a.force); a tarefa de agenda passa --year do ano corrente (schedule.py:192)
    dia = hoje or date.today()
    anos = list(r.anos) or list(range(_PRIMEIRO_ANO_SECRETAS, dia.year + 1))
    urls = [_sub(URL_SEN_VOTACAO_ANO, ano=str(a), fim=min(date(a, 12, 31), dia).isoformat()) for a in anos]  # senado_diario.py:74-76
    obs = _juntar(
        "" if r.anos else (f"sem recorte, a CLI percorre {_PRIMEIRO_ANO_SECRETAS}..{dia.year} (pela data {dia}); a tarefa da agenda roda só o ano corrente "
                           f"(--year {dia.year})"),
        _nota_reprocessar(r, "reprocessar: mesmo argv de recoletar; o run não leva checksum e o UPDATE é idempotente"),
    )
    return "senado.secretas", ["senado.secretas", *_anos_flags(r.anos)], _unicas(urls), False, obs, ""


# ---------------------------------------------------------------- agenda.congresso


def _janelas_agenda(dia: date, anos: list[int]) -> list[tuple[date, date]]:
    """Mesma regra de agenda_congresso.window (:55-61): --year = ano inteiro; sem ele, do 1º dia do mês passado ao fim do mês seguinte."""
    if anos:
        return [(date(y, 1, 1), date(y, 12, 31)) for y in sorted(anos)]
    primeiro = (dia.replace(day=1) - timedelta(days=1)).replace(day=1)
    proximo = (dia.replace(day=28) + timedelta(days=4)).replace(day=1)
    fim = (proximo.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return [(primeiro, fim)]


def _meses(a: date, b: date) -> list[date]:
    """Mesma regra de agenda_congresso.months (:64-69)."""
    out, d = [], a.replace(day=1)
    while d <= b:
        out.append(d)
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out


@adaptador("agenda.congresso")
def _agenda_congresso(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # cli.py:209: run_agenda(conn, years=a.year, force=a.force); sem --year a janela vem da data (agenda_congresso.py:241-244)
    dia = hoje or date.today()
    janelas = _janelas_agenda(dia, list(r.anos))
    urls: list[str] = []
    for a, b in janelas:
        urls.append(_sub(URL_AGENDA_CAMARA, inicio=a.isoformat(), fim=b.isoformat()))
        urls += [_sub(URL_AGENDA_SENADO_MES, mes=f"{m:%Y%m%d}") for m in _meses(a, b)]
    obs = _juntar(
        "" if r.anos else f"janela padrão da CLI ({janelas[0][0]} a {janelas[0][1]}), pela data {dia}",
        "só a 1ª página dos eventos da Câmara e os meses do Senado; " + c.entradas.depende_de,
        _nota_reprocessar(r, "reprocessar: mesmo argv de recoletar; os runs não levam checksum, sempre regravam"),
    )
    return "agenda.congresso", ["agenda.congresso", *_anos_flags(r.anos)], _unicas(urls), True, obs, ""


# ---------------------------------------------------------------- pauta


@adaptador("pauta")
def _pauta(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # cli.py:225: run_pauta(conn) sem argumento; today = datetime.now(BRT).date() (pauta.py:84); janela de hoje a hoje + 14 dias
    dia = hoje or datetime.now(BRT).date()
    fim = dia + timedelta(days=_JANELA_PAUTA_DIAS)
    meses = sorted({dia.replace(day=1), fim.replace(day=1)})  # pauta.py:183
    urls = [_sub(URL_PAUTA_CAMARA, inicio=dia.isoformat(), fim=fim.isoformat())]
    urls += [_sub(URL_PAUTA_SENADO_MES, mes=f"{m:%Y%m%d}") for m in meses]
    urls.append(_sub(URL_PAUTA_SENADO_COMISSOES, inicioAAAAMMDD=f"{dia:%Y%m%d}", fimAAAAMMDD=f"{fim:%Y%m%d}"))
    obs = _juntar(
        f"janela {dia} a {fim} derivada da data de execução (Brasília); outra data de execução muda as URLs",
        "só a 1ª página dos eventos da Câmara; " + c.entradas.depende_de,
        "fora do run-due: roda em etl-pauta.yml e em etl/agenda/agendar-local.sh",
    )
    return "pauta", ["pauta"], _unicas(urls), True, obs, ""


# ---------------------------------------------------------------- parlamento.extras


@adaptador("parlamento.extras")
def _parlamento_extras(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # cli.py:213: since = date(min(a.year) if a.year else ano-1, 1, 1): só o MENOR --year vale, os outros seriam ignorados sem aviso
    dia = hoje or date.today()
    if len(r.anos) > 1:
        return ("parlamento.extras", [], (), False, "",
                f"parlamento.extras lê só o menor --year (cli.py:213: since = 1/1 do menor ano) e ignora os demais; com {len(r.anos)} anos ({', '.join(map(str, r.anos))}) "
                f"o resto seria descartado em silêncio: peça um ano só (o menor, {min(r.anos)}, é o que valeria)")
    ano = r.anos[0] if r.anos else dia.year - 1
    since = date(ano, 1, 1)
    urls: list[str] = []
    partes = [
        "" if r.anos else f"sem --year o since é 1/1/{ano} (ano anterior à data {dia})",
        c.entradas.depende_de,
    ]
    if conn is None:
        urls.append(URL_SEN_LISTA_ATUAL)
        partes.append("sem banco, só a lista atual do Senado é conhecida (e só é lida se houver senador em exercício no banco); URLs por parlamentar dependem dos mandatos")
    else:
        rows = conn.execute(
            """select b.kind, e.external_id from mandates m join legislative_bodies b on b.id = m.body_id
               join person_external_ids e on e.person_id = m.person_id
                and e.source_id = (select id from sources where slug = case b.kind when 'senado' then 'senado' else 'camara' end)
               where m.status = 'em_exercicio' and b.kind in ('camara_deputados', 'senado') order by b.kind, e.external_id""").fetchall()
        n_dep = n_sen = 0
        for x in rows:
            ext = str(x["external_id"])
            if x["kind"] == "camara_deputados":
                n_dep += 1
                urls += [f"{CAM_API}/deputados/{ext}",
                         f"{CAM_API}/deputados/{ext}/orgaos?dataInicio={since.isoformat()}&itens=100",
                         f"{CAM_API}/deputados/{ext}/discursos?dataInicio={since.isoformat()}&dataFim={dia.isoformat()}&itens=100&ordenarPor=dataHoraInicio&ordem=DESC"]
            else:
                n_sen += 1
                urls += [f"{SEN_API}/senador/{ext}/comissoes.json", f"{SEN_API}/senador/{ext}/discursos.json?dataInicio={since:%Y%m%d}&dataFim={dia:%Y%m%d}"]
        if n_sen:
            urls.insert(0, URL_SEN_LISTA_ATUAL)
        partes.append(f"{n_dep} deputados e {n_sen} senadores com mandato em exercício no banco; só a 1ª página de órgãos e de discursos de cada deputado")
    partes.append(_nota_reprocessar(r, "reprocessar: mesmo argv de recoletar; o run não leva checksum, sempre regrava"))
    argv = ["parlamento.extras", *_anos_flags(r.anos)]
    return "parlamento.extras", argv, _unicas(urls), True, _juntar(*partes), ""


# ---------------------------------------------------------------- camara.presenca


def _legislaturas_do_ano(ano: int) -> list[int]:
    """Mesma regra de camara_presenca._legs_for_year (:39-43): janeiro de 2019, 2023 e 2027 ainda é da legislatura anterior."""
    out = [n for n, s in _INICIO_LEGISLATURA.items() if s.year <= ano < s.year + 4]
    if ano in (2019, 2023, 2027):
        out.append(out[0] - 1)
    return [n for n in out if n in _INICIO_LEGISLATURA]


@adaptador("camara.presenca")
def _camara_presenca(c: Coletor, r: Recorte, conn: Any, hoje: date | None) -> Plano:
    # cli.py:185: run_presenca(conn, years=a.year or [ano-1, ano], force=a.force)
    dia = hoje or date.today()
    anos = list(r.anos) or [dia.year - 1, dia.year]
    modelos = [u for u in c.entradas.urls if "{leg}" not in u]
    roster = [u for u in c.entradas.urls if "{leg}" in u]
    urls, pendentes = _expandir(modelos, anos)
    assert not pendentes
    legs = list(dict.fromkeys(n for a in anos for n in _legislaturas_do_ano(a)))
    urls = _unicas([*urls, *(_sub(m, leg=str(n)) for m in roster for n in legs)])
    partes = [
        "" if r.anos else f"anos padrão da CLI ({anos}), pela data {dia}",
        f"legislaturas {legs} (função do ano); só a 1ª página da lista de deputados de cada uma",
        c.entradas.depende_de,
        _nota_reprocessar(r, "reprocessar: mesmo argv de recoletar; com a mesma entrada o db.run pula por checksum (sem --force, que não é decidido aqui)"),
    ]
    return "camara.presenca", ["camara.presenca", *_anos_flags(r.anos)], urls, True, _juntar(*partes), ""

"""etl.camara.equipe: secretários parlamentares lotados em cada gabinete (D11).

Fonte: dadosabertos.camara.leg.br/arquivos/funcionarios/csv/funcionarios.csv (CC0), grupo "Secretário Parlamentar";
uriLotacao aponta para /deputados/{id}. Nome e nível do cargo (SP01..SP25) são publicados pela Câmara (LAI).
O arquivo não traz salário: monthly_salary_cents fica null ("—"), nunca 0. A remuneração por nível depende da tabela da
Mesa e da folha mensal (outra fonte; não carregada nesta rodada).
Senado: a lista de servidores do Senado (adm-dadosabertos /servidores) não liga o comissionado ao senador de forma
estável na lotação; não carregado (registrado em data-diff D11).
Snapshot: a equipe de hoje substitui a anterior do mesmo deputado (as_of = data da carga).
"""

from __future__ import annotations

import csv
import logging
from datetime import date

import psycopg

from ..db import SkipUnchanged, run, upsert
from ..http import fetch
from ..util import titlecase_pt

log = logging.getLogger("etl.camara.equipe")
URL = "https://dadosabertos.camara.leg.br/arquivos/funcionarios/csv/funcionarios.csv"


def run_equipe(conn: psycopg.Connection, *, force: bool = False) -> None:
    f = fetch(URL)
    src = str(conn.execute("select id from sources where slug = 'camara'").fetchone()["id"])
    ext = {r["external_id"]: str(r["person_id"]) for r in conn.execute("select external_id, person_id from person_external_ids where source_id = %s", (src,))}
    today = date.today()
    try:
        with run(conn, "camara.equipe", "camara", input_checksum=f.checksum, force=force) as r:
            rows, unknown = [], set()
            with open(f.path, encoding="utf-8-sig", newline="") as fh:
                for x in csv.DictReader(fh, delimiter=";"):
                    if x.get("grupo") != "Secretário Parlamentar":
                        continue
                    uri = (x.get("uriLotacao") or "").rstrip("/")
                    if "/deputados/" not in uri:
                        continue
                    dep = uri.rsplit("/", 1)[-1]
                    pid = ext.get(dep)
                    if not pid:
                        unknown.add(dep)
                        continue
                    role = f"Secretário parlamentar ({x['cargo']})" if x.get("cargo") else "Secretário parlamentar"
                    rows.append((pid, titlecase_pt(x["nome"]), role, None, "BRL", today, f"camara:{x['ponto']}"))
            persons = list({row[0] for row in rows})
            # snapshot: quem saiu do gabinete sai da lista
            conn.execute("delete from staff_members where source_key like 'camara:%%' and not (source_key = any(%s))", ([row[-1] for row in rows],))
            r.add(len(upsert(conn, "staff_members", ["person_id", "name", "role", "monthly_salary_cents", "currency", "as_of", "source_key"], rows,
                             ["source_key"], update=["person_id", "name", "role", "as_of"], returning=["id"])))
            if unknown:
                r.notes.append(f"{len(unknown)} lotações de deputado fora do diretório")
            log.info("câmara equipe: %d secretários em %d gabinetes", len(rows), len(persons))
    except SkipUnchanged:
        pass

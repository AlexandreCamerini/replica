"""Retrato da agenda (critério R-3): `schedule.TASKS`, `MAX_AGE_H` e `SOURCE_ENV` gravados em tests/retratos/agenda.json
sobre o commit 39ee3ec. Mudança nesse retrato exige decisão registrada. O arquivo é gerado uma vez; este teste só compara, não regrava.
"""

import dataclasses
import difflib
import json
from datetime import date
from pathlib import Path

from civico_etl import schedule as S

RETRATO = Path(__file__).resolve().parent / "retratos" / "agenda.json"
DATAS = {"2026-10-04": date(2026, 10, 4), "2027-03-10": date(2027, 3, 10)}  # ano eleitoral / fora de ano eleitoral
CHAMADAS = {"argv", "prefixes"}  # campos que são função da data: ficam em por_data, por chamada
# campo de Task -> chave do retrato onde ele aparece (dentro de por_data, para os campos de CHAMADAS)
CHAVE_EM_POR_DATA = {"argv": "argv", "prefixes": "families"}


def _window(w):
    if w is None:
        return None
    return {"start": w.start.strftime("%H:%M"), "end": w.end.strftime("%H:%M"), "days": list(w.days)}


def _tarefa(t: S.Task) -> dict:
    obj = {}
    for f in dataclasses.fields(S.Task):
        if f.name in CHAMADAS:
            continue
        v = getattr(t, f.name)
        obj[f.name] = _window(v) if f.name == "window" else v
    obj["retry_efetivo"] = t.retry()
    obj["por_data"] = {k: {"argv": t.argv(d), "families": list(t.families(d))} for k, d in DATAS.items()}
    return obj


def retrato() -> dict:
    return {
        "tasks": [_tarefa(t) for t in S.TASKS],
        "max_age_h": {k: S.MAX_AGE_H[k] for k in sorted(S.MAX_AGE_H)},
        "source_env": {k: S.SOURCE_ENV[k] for k in sorted(S.SOURCE_ENV)},
    }


def test_retrato_da_agenda_nao_mudou():
    vivo = retrato()
    gravado = json.loads(RETRATO.read_text(encoding="utf-8"))
    if vivo != gravado:
        a = json.dumps(gravado, ensure_ascii=False, indent=2).splitlines()
        b = json.dumps(vivo, ensure_ascii=False, indent=2).splitlines()
        diff = "\n".join(difflib.unified_diff(a, b, "gravado: tests/retratos/agenda.json", "vivo: retrato()", lineterm=""))
        raise AssertionError(
            "a agenda mudou em relação ao retrato gravado sobre 39ee3ec. Diferença completa abaixo "
            "(ou rode `pytest -vv tests/test_retrato_agenda.py`). Se a mudança é intencional, registre a decisão "
            "e regrave o retrato; este teste não regrava.\n" + diff
        )


def test_retrato_cobre_todos_os_campos_de_task():
    r = retrato()
    assert [t["name"] for t in r["tasks"]] == [t.name for t in S.TASKS]
    for f in dataclasses.fields(S.Task):
        for t in r["tasks"]:
            if f.name in CHAMADAS:
                for por in t["por_data"].values():
                    chave = CHAVE_EM_POR_DATA[f.name]
                    assert chave in por, f"campo {f.name} de Task sem '{chave}' no retrato de {t['name']}"
            else:
                assert f.name in t, f"campo {f.name} de Task ausente do retrato de {t['name']}"

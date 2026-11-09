"""D15: prompt caching, Message Batches e fallback síncrono do rascunho. Cliente Anthropic falso: não chama a API real, não usa banco."""

from __future__ import annotations

import json
from types import SimpleNamespace as NS

import anthropic
import httpx

from civico_etl import drafting
from civico_etl.jobs import rascunho as rj

PAGES = ["Art. 1º Fica criada a contribuição de 2,5% sobre a folha de pagamento das empresas do setor portuário."]
OK_ANSWERS = {f: {"diz": False, "frase": "", "trecho": "", "pagina": 0} for f in drafting.FIELDS} | {
    "dinheiro": {"diz": False, "frase": "", "trecho": "", "pagina": 0, "direcao": "nao_diz"}
}


def msg(stop="end_turn", text=None, model="claude-sonnet-5-5", **usage):
    u = {"input_tokens": 700, "output_tokens": 300, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, **usage}
    return NS(stop_reason=stop, stop_details=NS(category="cyber") if stop == "refusal" else None, model=model,
              content=[NS(type="text", text=json.dumps(OK_ANSWERS) if text is None else text)], usage=NS(**u))


class FakeClient:
    def __init__(self, statuses=("ended",), results=None, sync=None, create_error=None, retrieve_error=None, cancel_error=None, results_error=None):
        self.statuses, self.results, self.sync_resp, self.create_error = list(statuses), results or {}, sync or msg(), create_error
        self.retrieve_error, self.cancel_error, self.results_error = retrieve_error, cancel_error, results_error
        self.sync_calls, self.batch_requests, self.cancelled, self.polls = [], None, False, 0
        c = self
        self.beta = NS(messages=NS(create=lambda **kw: (c.sync_calls.append(kw), c.sync_resp)[1]))
        self.messages = NS(batches=NS(create=self._create, retrieve=self._retrieve, cancel=self._cancel, results=self._results))

    def _create(self, requests):
        if self.create_error:
            raise self.create_error
        self.batch_requests = requests
        return NS(id="msgbatch_1")

    def _retrieve(self, _id):
        self.polls += 1
        if self.retrieve_error:
            raise self.retrieve_error
        s = self.statuses[min(self.polls - 1, len(self.statuses) - 1)]
        return NS(processing_status="ended" if s == "ended" or (self.cancelled and s == "canceling") else s)

    def _cancel(self, _id):
        if self.cancel_error:
            raise self.cancel_error
        self.cancelled = True
        self.statuses = ["canceling", "ended"] if self.statuses[-1] != "stuck" else ["stuck"]

    def _results(self, _id):
        if self.results_error:
            raise self.results_error
        return [NS(custom_id=k, result=NS(type=t, message=m)) for k, (t, m) in self.results.items()]


class FakeRun:
    def __init__(self):
        self.notes, self.added, self.rejected = [], 0, []

    def add(self, n):
        self.added += n

    def reject(self, n=1, why=None):
        self.rejected.append(why)


class FakeStore:
    def __init__(self):
        self.saved, self.registered, self.closed, self.open = [], {}, {}, []

    def seen(self, m, sha, prompt_version=None):
        return any(s[0].sha == sha for s in self.saved)

    def save(self, p, answers, checks, served_by, u, cost):
        self.saved.append((p, u, cost, served_by))

    def open_batches(self):
        return self.open

    def register_batch(self, bid, model, items):
        self.registered[bid] = items

    def close_batch(self, bid, status, note=None):
        self.closed[bid] = status


def prep(n):
    return rj.Prep(f"camara-pl-{n}-2026", f"PL {n}/2026", None, f"http://x/{n}.pdf", f"sha{n}", PAGES,
                   {"body_id": "b", "prop_type": "PL", "prop_number": n, "prop_year": 2026})


def clock_and_sleep():
    t = [0.0]
    return (lambda: t[0]), (lambda s: t.__setitem__(0, t[0] + s))


def go(client, preps, wait_s=1200):
    store, r, tally = FakeStore(), FakeRun(), rj.Tally()
    clock, sleep = clock_and_sleep()
    rest = rj.run_batch(client, store, r, tally, "claude-sonnet-5-5", preps, wait_s=wait_s, poll_s=30, sleep=sleep, clock=clock)
    return store, r, tally, rest


# --- cache_control no bloco fixo ---------------------------------------------------------------------------------------

def test_bloco_fixo_vai_com_cache_control_e_o_documento_fica_fora():
    c = FakeClient()
    rj.draft_full(c, "claude-sonnet-5-5", "PL 1/2026", None, PAGES)
    kw = c.sync_calls[0]
    assert kw["system"] == [{"type": "text", "text": drafting.SYSTEM, "cache_control": {"type": "ephemeral"}}]
    assert "Fica criada a contribuição" not in json.dumps(kw["system"])  # o que varia por proposta não pode entrar antes do marcador
    assert kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"]  # regra de recusa preservada
    assert kw["model"] == "claude-sonnet-5-5"


def test_requisicao_do_lote_usa_ttl_de_1h_e_o_mesmo_corpo():
    c = FakeClient(results={"camara-pl-1-2026": ("succeeded", msg())})
    go(c, [prep(1)])
    params = c.batch_requests[0]["params"]
    assert c.batch_requests[0]["custom_id"] == "camara-pl-1-2026"
    assert params["system"][0]["cache_control"] == {"type": "ephemeral", "ttl": "1h"}
    assert {k: v for k, v in params.items() if k != "system"} == {k: v for k, v in drafting.request_params("claude-sonnet-5-5", "PL 1/2026", None, PAGES).items() if k != "system"}
    assert "fallbacks" not in params  # a API rejeita fallbacks em lote


# --- lote enviado e coletado -------------------------------------------------------------------------------------------

def test_lote_enviado_e_coletado_grava_pelo_mesmo_caminho_e_nao_chama_o_sincrono():
    c = FakeClient(statuses=["in_progress", "ended"], results={
        "camara-pl-1-2026": ("succeeded", msg(cache_read_input_tokens=600)),
        "camara-pl-2-2026": ("succeeded", msg(cache_creation_input_tokens=600)),
    })
    store, r, tally, rest = go(c, [prep(1), prep(2)])
    assert rest == [] and c.sync_calls == []
    assert [s[0].key for s in store.saved] == ["camara-pl-1-2026", "camara-pl-2-2026"] and r.added == 2
    assert set(store.registered["msgbatch_1"]) == {"camara-pl-1-2026", "camara-pl-2-2026"}
    assert store.registered["msgbatch_1"]["camara-pl-1-2026"]["sha"] == "sha1"
    assert store.closed == {"msgbatch_1": "coletado"}
    assert all(s[1].batch for s in store.saved)


def test_recusa_dentro_do_lote_volta_para_o_sincrono_que_tem_modelo_de_reserva():
    c = FakeClient(results={"camara-pl-1-2026": ("succeeded", msg(stop="refusal")), "camara-pl-2-2026": ("errored", None)})
    store, r, tally, rest = go(c, [prep(1), prep(2)])
    assert [p.key for p in rest] == ["camara-pl-1-2026", "camara-pl-2-2026"] and store.saved == [] and r.rejected == []


def test_corte_por_tamanho_no_lote_vira_nota_e_nao_repete():
    c = FakeClient(results={"camara-pl-1-2026": ("succeeded", msg(stop="max_tokens"))})
    store, r, _, rest = go(c, [prep(1)])
    assert rest == [] and "cortada" in r.rejected[0]


def test_lote_nao_enviado_cai_para_o_sincrono_com_nota():
    req = httpx.Request("POST", "http://x")
    c = FakeClient(create_error=anthropic.APIConnectionError(request=req))
    store, r, _, rest = go(c, [prep(1)])
    assert [p.key for p in rest] == ["camara-pl-1-2026"] and store.registered == {} and "lote não enviado" in r.notes[0]


# --- prazo: cancela e cai para o síncrono nos itens pendentes ---------------------------------------------------------

def test_no_prazo_cancela_aproveita_o_que_ficou_pronto_e_manda_o_resto_ao_sincrono():
    c = FakeClient(statuses=["in_progress"], results={
        "camara-pl-1-2026": ("succeeded", msg()),
        "camara-pl-2-2026": ("canceled", None),
    })
    store, r, tally, rest = go(c, [prep(1), prep(2)], wait_s=120)
    assert c.cancelled and any("cancelado" in n for n in r.notes)
    assert [s[0].key for s in store.saved] == ["camara-pl-1-2026"]
    assert [p.key for p in rest] == ["camara-pl-2-2026"]
    assert store.closed == {"msgbatch_1": "cancelado"}
    # e o pendente sai pelo síncrono, pelo mesmo caminho de gravação
    rj._sync_one(store, r, tally, c, "claude-sonnet-5-5", rest[0])
    assert len(c.sync_calls) == 1 and [s[0].key for s in store.saved][-1] == "camara-pl-2-2026"


def test_cancelamento_que_nao_fecha_deixa_o_lote_aberto_e_tudo_vai_ao_sincrono():
    c = FakeClient(statuses=["stuck"])
    store, r, _, rest = go(c, [prep(1)], wait_s=60)
    assert c.cancelled and len(rest) == 1 and store.closed == {}  # segue 'enviado': o próximo run coleta ou expira


def test_lote_cancelado_que_termina_depois_nao_duplica_o_que_o_sincrono_ja_gravou():
    store, r, tally = FakeStore(), FakeRun(), rj.Tally()
    p = prep(1)
    rj._finish(store, r, tally, p, OK_ANSWERS, drafting.Usage(10, 5), "claude-sonnet-5-5")
    rj._finish(store, r, tally, p, OK_ANSWERS, drafting.Usage(10, 5, batch=True), "claude-sonnet-5-5")
    assert len(store.saved) == 1


def test_run_seguinte_coleta_lote_que_terminou_depois(monkeypatch):
    p = prep(1)
    monkeypatch.setattr(rj, "_prep_from_item", lambda k, it, r, pv=None: p)
    c = FakeClient(results={"camara-pl-1-2026": ("succeeded", msg())})
    store, r, tally = FakeStore(), FakeRun(), rj.Tally()
    store.open = [{"batch_id": "msgbatch_9", "model": "m", "items": {"camara-pl-1-2026": {"label": "PL 1/2026"}}, "age_h": 3}]
    busy = rj.recover_open(c, store, r, tally)
    assert busy == set() and len(store.saved) == 1 and store.closed == {"msgbatch_9": "coletado"}


def test_lote_antigo_ainda_em_andamento_bloqueia_reenvio_e_expira_depois_de_25h():
    c = FakeClient(statuses=["in_progress"])
    store, r = FakeStore(), FakeRun()
    store.open = [{"batch_id": "msgbatch_9", "model": "m", "items": {"camara-pl-1-2026": {}}, "age_h": 3}]
    assert rj.recover_open(c, store, r, rj.Tally()) == {"camara-pl-1-2026"} and store.closed == {}
    store.open[0]["age_h"] = 26
    assert rj.recover_open(c, store, r, rj.Tally()) == set() and store.closed == {"msgbatch_9": "expirado"}


# --- degradação preservada ---------------------------------------------------------------------------------------------

def test_sincrono_recusa_e_formato_invalido_viram_nota_do_run():
    for resp, frag in ((msg(stop="refusal"), "recusou"), (msg(stop="max_tokens"), "cortada"), (msg(text="{"), "formato")):
        store, r, tally = FakeStore(), FakeRun(), rj.Tally()
        rj._sync_one(store, r, tally, FakeClient(sync=resp), "claude-sonnet-5-5", prep(1))
        assert store.saved == [] and frag in r.rejected[0]


# --- uso e custo -------------------------------------------------------------------------------------------------------

def test_custo_estimado_com_cache_e_lote():
    u = drafting.Usage(input=1000, output=500, cache_read=2000, cache_create=600)
    assert drafting.estimate_cost("claude-sonnet-5-5", u) == 0.0089  # (1000*2 + 500*10 + 2000*0.2 + 600*2.5) / 1e6
    ub = drafting.Usage(1000, 500, 2000, 600, batch=True, cache_ttl="1h")
    assert drafting.estimate_cost("claude-sonnet-5-5", ub) == 0.0049  # metade de (2000 + 5000 + 400 + 600*4)
    assert drafting.estimate_cost("modelo-desconhecido", u) is None


def test_uso_registrado_no_save_e_na_nota_do_run():
    c = FakeClient(results={"camara-pl-1-2026": ("succeeded", msg(cache_read_input_tokens=600, input_tokens=100, output_tokens=2000))})
    store, r, tally, _ = go(c, [prep(1)])
    p, u, cost, served = store.saved[0]
    assert (u.input, u.output, u.cache_read, u.cache_create, u.batch) == (100, 2000, 600, 0, True)
    assert cost == round((100 * 2 + 2000 * 10 + 600 * 0.2) / 1e6 * 0.5, 6)
    note = tally.note()
    assert "cache lido 600" in note and "por proposta" in note and "AVISO" not in note


def test_nota_avisa_quando_nada_passou_pelo_cache():
    t = rj.Tally()
    t.add(drafting.Usage(input=900, output=300), 0.01)
    assert "AVISO" in t.note()


def test_draft_legado_continua_devolvendo_entrada_e_saida():
    _, (i, o), served = rj.draft(FakeClient(sync=msg(cache_read_input_tokens=500)), "claude-sonnet-5-5", "PL 1/2026", None, PAGES)
    assert (i, o, served) == (1200, 300, "claude-sonnet-5-5")


# --- S3-3: --force chega até _finish; S3-4: erro transitório da API não derruba o run; S4: lote grava com o prompt de quando foi enviado ---

def test_force_nao_descarta_o_resultado_ja_pago():
    store, r, tally = FakeStore(), FakeRun(), rj.Tally()
    p = prep(1)
    rj._finish(store, r, tally, p, OK_ANSWERS, drafting.Usage(10, 5), "claude-sonnet-5-5")
    forced = prep(1)
    forced.force = True
    rj._finish(store, r, tally, forced, OK_ANSWERS, drafting.Usage(10, 5), "claude-sonnet-5-5")
    assert len(store.saved) == 2  # sem force o segundo seria descartado (teste acima); com force o pago é gravado


def test_prepare_marca_force_no_prep(monkeypatch):
    class Seen(FakeStore):
        def seen(self, m, sha, prompt_version=None):
            return True

    f = NS(checksum="shaX", path=NS(read_bytes=lambda: b""))
    monkeypatch.setattr(rj, "fetch_json", lambda *a, **k: {"dados": {"urlInteiroTeor": "http://x/1.pdf"}})
    monkeypatch.setattr(rj, "fetch", lambda *a, **k: f)
    monkeypatch.setattr(rj, "_pages", lambda b: PAGES * 5)
    c = {"body_id": "b", "prop_type": "PL", "prop_number": 1, "prop_year": 2026, "camara_id": 1, "key": "k", "summary_official": None}
    assert rj._prepare(Seen(), c, FakeRun(), force=False) is None  # já visto: pula
    p = rj._prepare(Seen(), c, FakeRun(), force=True)
    assert p is not None and p.force is True


def _api_error():
    return anthropic.APIConnectionError(request=httpx.Request("GET", "http://x"))


def test_consulta_do_lote_que_cai_tres_vezes_manda_tudo_ao_sincrono_e_deixa_o_lote_aberto():
    c = FakeClient(retrieve_error=_api_error())
    store, r, _, rest = go(c, [prep(1), prep(2)])
    assert len(rest) == 2 and store.closed == {} and "consulta falhou" in r.notes[-1]


def test_cancelamento_que_falha_no_prazo_cai_no_sincrono():
    c = FakeClient(statuses=["in_progress"], cancel_error=_api_error())
    store, r, _, rest = go(c, [prep(1)], wait_s=60)
    assert len(rest) == 1 and store.closed == {} and "cancelamento falhou" in r.notes[-1]


def test_leitura_dos_resultados_que_cai_manda_ao_sincrono_e_nao_fecha_o_lote():
    c = FakeClient(results_error=_api_error())
    store, r, _, rest = go(c, [prep(1)])
    assert [p.key for p in rest] == ["camara-pl-1-2026"] and store.closed == {} and "resultados não lidos" in r.notes[-1]


def test_recover_com_cancelamento_ou_resultados_com_erro_registra_nota_e_segue():
    store, r = FakeStore(), FakeRun()
    store.open = [{"batch_id": "msgbatch_9", "model": "m", "items": {"camara-pl-1-2026": {}}, "age_h": 26, "prompt_version": 1}]
    busy = rj.recover_open(FakeClient(statuses=["in_progress"], cancel_error=_api_error()), store, r, rj.Tally())
    assert busy == {"camara-pl-1-2026"} and store.closed == {} and "cancelamento falhou" in r.notes[-1]


def test_recover_usa_o_prompt_version_do_lote(monkeypatch):
    seen_pv = []
    p = prep(1)

    def fake_prep(k, it, r, pv=None):
        seen_pv.append(pv)
        p.prompt_version = pv
        return p

    monkeypatch.setattr(rj, "_prep_from_item", fake_prep)
    store, r = FakeStore(), FakeRun()
    store.open = [{"batch_id": "msgbatch_9", "model": "m", "items": {"camara-pl-1-2026": {"label": "PL 1/2026"}}, "age_h": 3, "prompt_version": 1}]
    rj.recover_open(FakeClient(results={"camara-pl-1-2026": ("succeeded", msg())}), store, r, rj.Tally())
    assert seen_pv == [1] and store.saved[0][0].prompt_version == 1


def test_pgstore_grava_e_consulta_com_o_prompt_version_do_prep():
    class Conn:
        def __init__(self):
            self.calls = []

        def execute(self, sql, params=None):
            self.calls.append((sql, params))
            return NS(fetchone=lambda: None)

        def commit(self):
            pass

    conn = Conn()
    st = rj.PgStore(conn)
    st._wide = False
    p = prep(1)
    p.prompt_version = 1
    st.save(p, OK_ANSWERS, {}, "m", drafting.Usage(7, 9), None)
    insert = [c for c in conn.calls if c[0].startswith("insert into answer_drafts")][0]
    assert drafting.PROMPT_VERSION != 1 and insert[1][8] == 1  # coluna prompt_version
    st.seen(p.meta, "sha1", 1)
    assert conn.calls[-1][1][-1] == 1

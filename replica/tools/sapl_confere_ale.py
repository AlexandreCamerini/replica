import json, sys, time, urllib.request
def get(u):
    for t in range(5):
        time.sleep(1.1)
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "civico-etl-conferencia"}), timeout=60))
        except Exception as e:
            err = e
    raise err
def allp(u):
    out, n = [], 1
    while True:
        d = get(f"{u}{'&' if '?' in u else '?'}page_size=25&page={n}")
        out += d["results"]
        if not d["pagination"]["next_page"]: return out
        n += 1
for uf, base, pid, ini in [("PB","https://sapl.al.pb.leg.br",59,"2023-02-01"),("PI","https://sapl.al.pi.leg.br",312,"2023-02-01"),("RO","https://sapl.al.ro.leg.br",297,"2023-02-01"),("AM","https://sapl.al.am.leg.br",71,"2023-02-01")]:
    nome = get(f"{base}/api/parlamentares/parlamentar/{pid}/")["nome_parlamentar"]
    sess = {s["id"] for s in allp(f"{base}/api/sessao/sessaoplenaria/?data_inicio__gte={ini}&o=id")}  # filtro por data, independente do caminho do loader (legislatura=)
    pres = {p["sessao_plenaria"] for p in allp(f"{base}/api/sessao/sessaoplenariapresenca/?parlamentar={pid}&o=id")}
    votos = [v for v in allp(f"{base}/api/sessao/votoparlamentar/?parlamentar={pid}&o=id") if (v.get("data_hora") or "") >= ini]
    print(json.dumps({"uf": uf, "parlamentar": nome, "sapl_id": pid, "sessoes_com_presenca": len(pres & sess), "presencas_sem_filtro_de_data": len(pres), "votos": len(votos)}, ensure_ascii=False))

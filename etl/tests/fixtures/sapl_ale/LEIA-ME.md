# Respostas FABRICADAS do SAPL (FABRICADO)

Tudo nesta pasta é FABRICADO: nada foi lido do SAPL de nenhuma casa. Nomes ("Parlamentar Fabricado 1 (RO)"), números e textos são inventados. Os cinco hosts das Assembleias são as constantes `ALE_SAPL` do código (RO, AC, AM, PI, PB); o município é o IBGE `1190099`, "Município Fabricado (teste)" (UF RO), com hosts `.invalid` (TLD reservado, não resolve). Nunca apresente isto como dado lido da fonte; todo relatório que usar esta pasta marca SIMULADO.

## Quem lê

`civico_etl/jobs/sapl.py` (comandos `sapl.ales`, `sapl.descobrir --ibge`, `sapl.carregar --ibge`), pelo transporte `httpx.MockTransport` de `etl/tests/admin_fixtures.py` (`transporte`, `instalar`) ou pelo lançador `etl/tests/simulado.py`. Nada sai para a rede.

## Formato

`<cenário>/mapa.json` liga cada URL exata (com query string, na ordem em que o job a monta) a `{arquivo, status, tipo, etag}` ou `{excecao}`. `arquivo` é relativo ao diretório do cenário; o que não mudou aponta para `../v1/...` (mesmo arquivo, mesma ETag, para exercitar 304). `curingas` (regex) cobrem duas famílias de URL que dependem da data de hoje (`?tipo=T&ano=Y` de cada ano até o corrente; `data_ultima_atualizacao__gte=<hoje-2>`) e devolvem página vazia. A legislatura fabricada vai de 2023-02-01 a 2030-12-31, para conter "hoje". Gerado por `_gerar.py` (nesta pasta); regere em vez de editar à mão.

## Cenários

- `v1`: Estado inicial. RO, AC e AM: robots permissivo e API respondendo (carga completa possível). PI: robots.txt bloqueia /api/ (status robots_bloqueia). PB: robots permissivo e /api/ responde 500 (status fora_do_ar). Município fabricado: registro lista o SAPL em HOST_MUN_V1, robots e API ok.
- `v2`: O mesmo tempo depois. PB volta (ok). AM passa a ter robots que bloqueia /api/ (robots_bloqueia). RO: matéria 306 (3/2026) com autoria 411 nova e o parlamentar 102 com nome e `ativo` alterados. Município: o registro aponta para HOST_MUN_V2 (base_url muda; as respostas dos dois hosts existem). Só o que mudou tem ETag nova.
- `falhas`: Erros: RO /api/ 403; AC /api/ ReadTimeout; AM /api/ 200 com corpo vazio; PI /api/ ok mas a primeira leitura da carga (legislatura) dá 500; PB ok (igual ao v2).

## URLs do cenário `v1` (87 exatas + 10 curingas)

### https://sapl.al.ro.leg.br

- `/robots.txt -> 200`
- `/api/ -> 200`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2026&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200`
- `/api/base/autor/?page_size=100&page=1 -> 200`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200`

### https://sapl.al.ac.leg.br

- `/robots.txt -> 200`
- `/api/ -> 200`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200`
- `/api/base/autor/?page_size=100&page=1 -> 200`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200`

### https://sapl.al.am.leg.br

- `/robots.txt -> 200`
- `/api/ -> 200`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2026&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200`
- `/api/base/autor/?page_size=100&page=1 -> 200`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200`

### https://sapl.al.pi.leg.br

- `/robots.txt -> 200`

### https://sapl.al.pb.leg.br

- `/robots.txt -> 200`
- `/api/ -> 500`

### https://www12.senado.leg.br

- `/interlegis/orgaosatendidos?uf=RO&municipio=Munic%C3%ADpio%20Fabricado%20%28teste%29 -> 200`

### https://sapl.camara-fabricada.invalid

- `/robots.txt -> 200`
- `/api/ -> 200`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2026&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200`
- `/api/base/autor/?page_size=100&page=1 -> 200`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200`

## URLs do cenário `v2` (107 exatas + 10 curingas)

### https://sapl.al.ro.leg.br

- `/robots.txt -> 200 (= v1)`
- `/api/ -> 200 (= v1)`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200 (= v1)`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200 (= v1)`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?tipo=1&ano=2026&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200`
- `/api/base/autor/?page_size=100&page=1 -> 200 (= v1)`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200 (= v1)`

### https://sapl.al.ac.leg.br

- `/robots.txt -> 200 (= v1)`
- `/api/ -> 200 (= v1)`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200 (= v1)`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200 (= v1)`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200 (= v1)`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200 (= v1)`
- `/api/base/autor/?page_size=100&page=1 -> 200 (= v1)`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200 (= v1)`

### https://sapl.al.am.leg.br

- `/robots.txt -> 200`

### https://sapl.al.pi.leg.br

- `/robots.txt -> 200 (= v1)`

### https://sapl.al.pb.leg.br

- `/robots.txt -> 200 (= v1)`
- `/api/ -> 200`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2026&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200`
- `/api/base/autor/?page_size=100&page=1 -> 200`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200`

### https://www12.senado.leg.br

- `/interlegis/orgaosatendidos?uf=RO&municipio=Munic%C3%ADpio%20Fabricado%20%28teste%29 -> 200`

### https://sapl.camara-fabricada.invalid

- `/robots.txt -> 200 (= v1)`
- `/api/ -> 200 (= v1)`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200 (= v1)`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200 (= v1)`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200 (= v1)`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?tipo=1&ano=2026&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200 (= v1)`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200 (= v1)`
- `/api/base/autor/?page_size=100&page=1 -> 200 (= v1)`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200 (= v1)`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200 (= v1)`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200 (= v1)`

### https://sapl.camara-fabricada-nova.invalid

- `/robots.txt -> 200`
- `/api/ -> 200`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=1&ano=2026&page_size=100&page=1 -> 200`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200`
- `/api/base/autor/?page_size=100&page=1 -> 200`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200`

## URLs do cenário `falhas` (30 exatas + 10 curingas)

### https://sapl.al.ro.leg.br

- `/robots.txt -> 200 (= v1)`
- `/api/ -> 403 (= v1)`

### https://sapl.al.ac.leg.br

- `/robots.txt -> 200 (= v1)`
- `/api/ -> ReadTimeout`

### https://sapl.al.am.leg.br

- `/robots.txt -> 200 (= v1)`
- `/api/ -> 200 (= v1)`

### https://sapl.al.pi.leg.br

- `/robots.txt -> 200`
- `/api/ -> 200`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 500 (= v1)`

### https://sapl.al.pb.leg.br

- `/robots.txt -> 200 (= v1)`
- `/api/ -> 200 (= v2)`
- `/api/parlamentares/legislatura/?page_size=100&page=1 -> 200 (= v2)`
- `/api/parlamentares/parlamentar/?page_size=100&page=1 -> 200 (= v2)`
- `/api/parlamentares/parlamentar/?page_size=100&page=2 -> 200 (= v2)`
- `/api/parlamentares/mandato/?legislatura=7&page_size=100&page=1 -> 200 (= v2)`
- `/api/materia/tipomaterialegislativa/?page_size=100&page=1 -> 200 (= v2)`
- `/api/materia/materialegislativa/?o=-id&page_size=1&page=1 -> 200 (= v2)`
- `/api/materia/materialegislativa/?o=-id&page_size=100&page=1 -> 200 (= v2)`
- `/api/materia/materialegislativa/?tipo=1&ano=2025&page_size=100&page=1 -> 200 (= v2)`
- `/api/materia/materialegislativa/?tipo=1&ano=2026&page_size=100&page=1 -> 200 (= v2)`
- `/api/materia/materialegislativa/?tipo=2&ano=2025&page_size=100&page=1 -> 200 (= v2)`
- `/api/materia/autoria/?o=-id&page_size=1&page=1 -> 200 (= v2)`
- `/api/materia/autoria/?o=-id&page_size=100&page=1 -> 200 (= v2)`
- `/api/base/autor/?page_size=100&page=1 -> 200 (= v2)`
- `/api/contenttypes/contenttype/?model=parlamentar&page_size=100&page=1 -> 200 (= v2)`
- `/api/sessao/sessaoplenaria/?legislatura=7&page_size=100&page=1 -> 200 (= v2)`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=1&page=1 -> 200 (= v2)`
- `/api/sessao/sessaoplenariapresenca/?o=-id&page_size=100&page=1 -> 200 (= v2)`
- `/api/sessao/votoparlamentar/?o=-id&page_size=1&page=1 -> 200 (= v2)`
- `/api/sessao/votoparlamentar/?o=-id&page_size=100&page=1 -> 200 (= v2)`


# Onde rodar o SAPL em escala (D08) — comparativo para o dono decidir

Preços consultados em 09/11/2026 nas páginas oficiais; confira de novo antes de contratar. Nada foi contratado nem criado.

## O que precisa rodar (medido em 09/11/2026, banco local)
- `civico-etl run-due` a cada 3 h; a tarefa `sapl.todas` vence a cada 20 h. Lote: 150 câmaras, 4 em paralelo, orçamento de 150 min.
- 1ª carga de uma câmara real (com legislatura vigente): 31 a 264 s, mediana 57 s (9 câmaras do PA, 4 workers). A estimativa antiga era ~10 min.
- Recarga incremental: 20 a 33 s por câmara.
- Descoberta: ~100 municípios em ~3 min (1 host do Interlegis, 1,1 s por requisição); 400/dia ≈ 12 min. Os 5.571 municípios ficam descobertos em ~14 dias.
- Memória: um processo Python com 4 threads; ordem de 300–500 MB (não medida com precisão: confirmar com `/usr/bin/time -l` antes de dimensionar a máquina).
- Precisa de rede para centenas de hosts de câmaras e de uma conexão de escrita no Postgres.
- Orçamento diário realista: 30 a 60 min de carga ativa. O orçamento de 150 min é teto, não consumo.

## Comparativo
| | launchd local (Mac) | Fly.io Machine agendada | Railway (cron service) | GitHub Actions (repo privado) |
|---|---|---|---|---|
| Custo | US$ 0 | shared-cpu-1x 256 MB: US$ 2,19/mês ligada o mês todo; RAM extra US$ 6/GB/mês. Ligada só ~1 h/dia (cobrança por segundo): ~US$ 0,3 a 1 por mês | Hobby US$ 5/mês com US$ 5 de crédito; RAM ~US$ 10/GB/mês, CPU ~US$ 20/vCPU/mês. 1 h/dia de 1 GB + 0,5 vCPU fica dentro do crédito: ~US$ 5 | Free: 2.000 min/mês; Linux 2 núcleos US$ 0,006/min além disso. 150 min/dia = 4.500 min/mês ≈ US$ 27 brutos, ~US$ 15 depois da franquia (se nada mais usar minutos; o `etl.yml` de 3 em 3 h já usa) |
| Estabilidade | depende do Mac ligado e acordado | alta, mas só se o dono montar imagem + secrets + agendamento | alta, idem | alta, já existe o workflow (desligado por `ETL_SCHEDULE_ENABLED`) |
| Esforço | nenhum (já existe `etl/deploy/launchd-install.sh`) | Dockerfile + `fly machine run --schedule` + secrets | idem | quase nenhum |
| Risco | noite sem Mac = lote perdido; a fila retoma sozinha | segredo de escrita do banco de produção fora do Mac | idem | minutos pagos crescem com o lote; catálogo D08 já descartou |
| Escala | 4 workers, 1 IP residencial | pode subir workers; IP fixo de datacenter pode ser barrado por algum host de câmara | idem | runners compartilhados |

Fontes: [Fly.io](https://fly.io/docs/about/pricing/), [Railway](https://docs.railway.com/pricing/plans), [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions). A página de referência da Railway lista também US$ 50/GB e US$ 50/vCPU; pareceu ser de outro produto (sandbox), então usei US$ 10 e US$ 20.

## Leitura (recomendação, o dono decide)
- Com o que foi medido, o launchd local já dá conta do aceite (300 câmaras em 2 semanas exige ~21 cargas/dia; a capacidade medida é de dezenas de vezes isso). O que ele não dá é regularidade: Mac fechado = lote perdido.
- Se a regularidade importar, Fly (ou Railway) agendado custa de centavos a ~US$ 5/mês. É ganho de estabilidade, não de capacidade. O preço real é dar ao runner o segredo de escrita do banco de produção.
- Actions: não recomendo. É a opção mais cara e já foi descartada no catálogo.
- Em qualquer opção a descoberta (14 dias) e o ritmo de cargas reais, não o hardware, limitam o prazo. 30 de 39 câmaras "ok" do lote de teste não têm legislatura vigente no SAPL (ver D271).

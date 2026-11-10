# Ativar a cópia do bruto (D12 / D280)

Desligada por padrão. Nada abaixo foi feito em produção; é o passo a passo para o dono.

## 1. Migração
Aplicar `db/migrations/0120_raw_copy.sql` (aditiva) com o `prod-migrate.sh`. Sem ela, com o armazenamento ligado, o UPDATE do `raw_uri` falha dentro do savepoint e fica só a nota "cópia do bruto falhou".

## 2. Escolher o backend

### Supabase Storage
1. Dashboard → Storage → New bucket `raw-dumps`, **privado** (Public bucket desligado).
2. Env do job do ETL (GitHub Actions secrets, nunca no web):
   - `ETL_RAW_STORE=supabase`
   - `ETL_RAW_SUPABASE_URL=https://<ref>.supabase.co`
   - `ETL_RAW_SUPABASE_KEY=<service_role>`
   - `ETL_RAW_BUCKET=raw-dumps` (opcional)

### Cloudflare R2
1. R2 → Create bucket `raw-dumps` (sem acesso público) e um API token com Object Read & Write só nesse bucket.
2. `pip install boto3` no ambiente do ETL, e:
   - `ETL_RAW_STORE=r2`
   - `ETL_RAW_R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com`
   - `ETL_RAW_R2_KEY_ID=...` `ETL_RAW_R2_SECRET=...` `ETL_RAW_BUCKET=raw-dumps`

### Disco (local)
`ETL_RAW_STORE=local` e, se quiser, `ETL_RAW_DIR=/caminho` (padrão `etl/.raw`, ignorado pelo git? adicione ao .gitignore se for usar).

## 3. Retenção
Agendar `python -m civico_etl purge-raw` (diário). Apaga o bruto com mais de 90 dias; `tse.*` nunca vence.

## 4. Verificação
```sql
select dataset, status, raw_uri, raw_bytes, raw_expires_at
from ingest_runs where status in ('succeeded', 'partial') and started_at > now() - interval '1 day' and raw_uri is null;
```
Deve voltar vazio depois de ligar. Para ler um dado datado: abra o manifesto em `raw_uri`; ele lista url, sha256 e o objeto de cada arquivo.

## 5. Limites conhecidos
- Zips remotos do TSE lidos por Range entram no manifesto só com url (sem cópia).
- Respostas da API com chave (Portal da Transparência) não são arquivadas.
- Os objetos do bucket não têm lifecycle próprio; a retenção é do `purge-raw`.

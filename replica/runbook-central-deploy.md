# Runbook: publicar a central (admin.segueovoto.com.br)

Escrito em 28/11/2026, depois de um deploy da central que saiu em 404. Vale para o projeto Vercel `segueovoto-admin` (time `sementedev`).

## Fatos

- O projeto **não está ligado ao Git**: merge na `main` não publica a central. Só muda quando alguém roda o deploy pelo CLI.
- O projeto **não tem build próprio** (`framework: null`). O build certo vem de um `vercel.json` que o script grava numa cópia limpa de `web/`:
  `next build && node scripts/manifestos-rotas-central.mjs`. Sem ele, o deploy termina em 5 a 7 s e **toda rota responde `NOT_FOUND` da plataforma**
  (cabeçalho `x-vercel-error`). O sinal de build certo no log é `Detected Next.js version` e `[manifestos-rotas-central] N manifesto(s) ... criados`.
- Depois de um `vercel rollback`, a Vercel **não aponta deploys novos para o domínio sozinha**: é preciso `vercel promote`.
- O banco da central é o **mesmo Supabase do site** (`ADMIN_DATABASE_URL` no pooler). `max_connections` é 60; cada instância da central abre até 2 conexões. Se o banco
  ficar sem conexão (`SQLSTATE 53300`), a conferência de identidade falha e a central responde **404** (de propósito: não revela nada). Procure `[admin] identidade: 53300` no log.
- Migração que o código novo exige tem de estar aplicada **antes** de promover (ex.: a 0159, tabela `login.central_envios_origem`).

## Publicar

```bash
bash web/scripts/central-deploy.sh --seco     # monta e confere a cópia, não chama a Vercel
bash web/scripts/central-deploy.sh            # publica origin/main; testa o deploy com `vercel curl`; só então pergunta se promove
REF=<commit> bash web/scripts/central-deploy.sh   # outro commit
```

O script nunca mexe em variável de ambiente, em domínio nem no projeto do site (`replica`).

## Voltar

```bash
vercel ls --prod --scope sementedev        # ache o deploy anterior
vercel promote <url-do-deploy-anterior> --scope sementedev
```

## Teste de login

Só a pessoa consegue (Turnstile e código por e-mail): peça um código em https://admin.segueovoto.com.br/admin/entrar. Se o e-mail chegar e a tela do código aceitar, o login está bom.
Se der "não encontrado", leia o log de runtime: `53300` é banco sem conexão; `NOT_FOUND` da plataforma é deploy sem o build da central.

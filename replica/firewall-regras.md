# Regras de firewall da Vercel: limite por IP no login

Estado em 19/11/2026: **não aplicado**. A API de firewall não está liberada para a conexão do Claude com a Vercel (404 em `get_firewall_config`), então as regras são aplicadas pelo painel ou pela CLI.

## Por que é obrigatório antes do corte

- Na D336, o login `pg` do site ganhou um teto global de 300 envios de código por hora.
- Sem limite por IP, quem resolve 300 captchas por hora esgota esse teto e derruba o login do site inteiro.
- O mesmo vale para a entrada da central, que limita por e-mail, mas não por IP.

O limite precisa estar no firewall, porque a aplicação não tem limite por IP.

O rate limiting do firewall depende do plano da equipe na Vercel. Confira no painel em Firewall > Rules > "Rate Limit". Se o plano não oferecer, a alternativa é a ação "challenge" em vez de limite.

## Regra 1: site (projeto `replica`)

- **Nome:** `login: limite por IP`.
- **Condições** (todas):
  - Request Path começa com `/entrar`;
  - Method igual a `POST`.

  As server actions do login (`sendCode`, `verifyCode`) chegam como POST em `/entrar`.
- **Ação:** Rate Limit.
  - Algoritmo: Fixed Window.
  - Janela: 60 s.
  - Limite: 10 pedidos.
  - Chave: IP.
  - Ao estourar: Deny por 10 min.
- **Teste depois de aplicar:**
  - 12 POSTs seguidos de um mesmo IP em `/entrar`: a partir do 11º, 429 ou 403.
  - Um GET em `/entrar` continua 200.

Corpo equivalente para a API (`update_firewall_config`, ação `rules.insert`), para quando a conexão tiver acesso:

```json
{
  "action": "rules.insert",
  "id": null,
  "value": {
    "name": "login: limite por IP",
    "description": "D336: o teto global de envio de código (300/h) não pode virar negação de serviço",
    "active": true,
    "conditionGroup": [
      { "conditions": [
        { "type": "path", "op": "pre", "value": "/entrar" },
        { "type": "method", "op": "eq", "value": "POST" }
      ] }
    ],
    "action": { "mitigate": {
      "action": "rate_limit",
      "rateLimit": { "algo": "fixed_window", "window": 60, "limit": 10, "keys": ["ip"], "action": "deny" },
      "actionDuration": "10m"
    } }
  }
}
```

## Regra 2: central (projeto `admin.`, quando existir)

É a mesma regra, com duas trocas:

- path começa com `/admin/api/entrar`;
- limite de 10 por 60 s por IP.

As rotas da central já respondem num tempo fixo de 1,5 s. O limite corta a força bruta distribuída por e-mail.

## Volta

Desligar a regra (`active: false`) no painel. O efeito é imediato e não precisa de redeploy.

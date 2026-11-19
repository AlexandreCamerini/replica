-- Só local: login do role da central de administração (criado nologin pela migração 0153). Senha de desenvolvimento, sem valor fora desta máquina.
-- Idempotente: `db/migrate.sh --local` roda todo post_*.sql a cada execução, depois das migrações (o role já existe).
-- Publicar a central com login de verdade (e papel de admin) fica para depois: nada disto vale em produção.
alter role admin_central login password 'admin_central';

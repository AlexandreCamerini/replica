-- Só local: admin de desenvolvimento para o modo local da central (AC-23: `ADMIN_CENTRAL=1`, identidade `ADMIN_LOCAL_EMAIL`, que tem de constar ativo em `adm_admins`).
-- `.invalid` é reservado (RFC 2606): o endereço não existe fora desta máquina. Idempotente: `db/migrate.sh --local` roda todo post_*.sql a cada execução.
-- Tolera banco sem a 0156 (o teste de migração aplica só as anteriores à 0150 e roda os post_*): sem a tabela, não faz nada.
-- Nada disto vale em produção: lá os admins são cadastrados pelo dono do banco.
do $$
begin
  if to_regclass('public.adm_admins') is not null then
    insert into public.adm_admins (email, nome) values ('operador.local@segueovoto.invalid', 'Operador local') on conflict (email) do nothing;
  end if;
end $$;

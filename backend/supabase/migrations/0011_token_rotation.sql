-- 0011_token_rotation.sql — in-place Vault rotation for refreshed platform tokens.
--
-- store_account_token() (0008) always vault.create_secret()s a NEW secret with a fixed name
-- ('acct_token_<account>'), which collides on the second call. Token refresh must UPDATE the
-- existing secret in place (keeping the same token_ref), so add a dedicated rotation function.

create or replace function rotate_account_token(p_account uuid, p_token text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_ref text;
begin
  select token_ref into v_ref from connected_account where id = p_account;

  -- No usable existing secret yet → fall back to first-time storage.
  if v_ref is null or v_ref = 'pending' then
    perform store_account_token(p_account, p_token);
    return;
  end if;

  begin
    perform vault.update_secret(v_ref::uuid, p_token);
  exception when others then
    -- token_ref wasn't a valid secret id (e.g. legacy row) → store fresh.
    perform store_account_token(p_account, p_token);
  end;
end;
$$;

# Inventário conhecido do banco (lido do código / shim VPS)

> Schema SQL completo vem do `vps-backup-full.sh` (`pg_dump --schema-only`).
> Esta lista é referência rápida — não substitui o dump.

## Tabelas usadas pelo sistema

- `profiles` — **mesma tabela do site antigo** (dump Cloud→VPS). Campos de cliente no Meu Perfil v2: `full_name`, `phone`, `location`, `cpf`, `pix_key`, `pix_priority_type`, `pix_bank`, `pix_account`, `pix_account_holder`, `avatar_url`, `created_at` (+ e-mail em `auth.users`). Auditoria: `scripts/vps-audit-profiles-migration.sh`.
- `user_roles`
- `protections`
- `matches`
- `notifications`
- `wallet_transactions`
- `manual_deposits`
- `asaas_payments`
- `refund_requests`
- `back_refund_requests`
- `withdrawals`
- `partner_withdraw_requests`
- `admin_expenses`
- `platform_treasury`
- `affiliate_stats`
- `desafios`
- `desafio_steps`
- `odd_contestations`
- `back_protections`

## Auth

- `auth.users` (GoTrue / Supabase Auth) — **não versionar dados**

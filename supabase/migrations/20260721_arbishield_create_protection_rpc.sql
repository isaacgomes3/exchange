-- ArbiShield: criar proteção + débito no ledger na MESMA transação.
-- Corrige "Falha Crítica de Integridade: ... sem registro de débito no saldo".

CREATE OR REPLACE FUNCTION public.arbishield_create_protection(
  p_user_id uuid,
  p_match_id uuid,
  p_market_type text,
  p_amount_cents integer,
  p_odd numeric,
  p_side text DEFAULT 'home',
  p_balance_type text DEFAULT 'REAL',
  p_balance_before integer DEFAULT NULL,
  p_balance_after integer DEFAULT NULL,
  p_profile_patch jsonb DEFAULT '{}'::jsonb,
  p_protection jsonb DEFAULT '{}'::jsonb,
  p_lock_type text DEFAULT NULL,
  p_protection_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pid uuid := COALESCE(p_protection_id, gen_random_uuid());
  v_lock_type text := COALESCE(
    NULLIF(trim(p_lock_type), ''),
    CASE WHEN upper(COALESCE(p_market_type, 'LAY')) = 'BACK'
      THEN 'protection_lock' ELSE 'anchor_lock' END
  );
  v_meta jsonb := jsonb_build_object(
    'protection_id', v_pid,
    'match_id', p_match_id,
    'market_type', upper(COALESCE(p_market_type, 'LAY')),
    'balance_type', upper(COALESCE(p_balance_type, 'REAL')),
    'fix', 'integridade-debito-v3'
  );
  v_prot_meta jsonb;
BEGIN
  IF p_user_id IS NULL OR p_match_id IS NULL THEN
    RAISE EXCEPTION 'user_id e match_id obrigatórios';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Valor inválido';
  END IF;

  -- 1) Débito no perfil
  IF p_profile_patch IS NOT NULL AND p_profile_patch <> '{}'::jsonb THEN
    UPDATE public.profiles p
    SET
      balance_cents = COALESCE((p_profile_patch->>'balance_cents')::bigint, p.balance_cents),
      reusable_balance_cents = COALESCE((p_profile_patch->>'reusable_balance_cents')::bigint, p.reusable_balance_cents),
      demo_balance_cents = COALESCE((p_profile_patch->>'demo_balance_cents')::bigint, p.demo_balance_cents),
      investor_balance_cents = COALESCE((p_profile_patch->>'investor_balance_cents')::bigint, p.investor_balance_cents),
      locked_balance_cents = COALESCE((p_profile_patch->>'locked_balance_cents')::bigint, p.locked_balance_cents),
      updated_at = now()
    WHERE p.id = p_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Perfil não encontrado';
    END IF;
  END IF;

  -- 2) Ledger (débito) — ANTES da proteção, mesma TX
  INSERT INTO public.wallet_transactions (
    user_id, type, amount_cents, balance_before_cents, balance_after_cents, ref, metadata
  ) VALUES (
    p_user_id,
    v_lock_type,
    -ABS(p_amount_cents),
    p_balance_before,
    p_balance_after,
    v_pid,
    v_meta
  );

  BEGIN
    EXECUTE $q$
      UPDATE public.wallet_transactions
         SET meta = $1
       WHERE ref = $2 AND user_id = $3 AND created_at >= now() - interval '5 seconds'
    $q$ USING v_meta, v_pid, p_user_id;
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;

  -- 3) INSERT proteção com triggers de usuário desligados nesta TX
  PERFORM set_config('session_replication_role', 'replica', true);

  v_prot_meta := COALESCE(p_protection->'metadata', '{}'::jsonb) || v_meta;

  IF upper(COALESCE(p_market_type, 'LAY')) = 'BACK' THEN
    INSERT INTO public.back_protections (
      id, user_id, match_id, odd, status,
      amount_cents, user_profit_cents, platform_deduction_cents,
      balance_before_cents, balance_after_cents, metadata
    ) VALUES (
      v_pid,
      p_user_id,
      p_match_id,
      p_odd,
      'active',
      COALESCE((p_protection->>'amount_cents')::integer, p_amount_cents),
      COALESCE((p_protection->>'user_profit_cents')::integer, 0),
      COALESCE((p_protection->>'platform_deduction_cents')::integer, 0),
      p_balance_before,
      p_balance_after,
      v_prot_meta
    );
  ELSE
    INSERT INTO public.protections (
      id, user_id, match_id, side, odd, status,
      amount_cents, responsibility_cents, user_profit_cents,
      platform_deduction_cents, platform_profit_cents,
      locked_deduction_cents, exchange_fee_cents, exchange_profit_net_cents,
      balance_before_cents, balance_after_cents, metadata
    ) VALUES (
      v_pid,
      p_user_id,
      p_match_id,
      COALESCE(NULLIF(p_side, ''), 'home'),
      p_odd,
      'active',
      COALESCE((p_protection->>'amount_cents')::integer, p_amount_cents),
      COALESCE((p_protection->>'responsibility_cents')::integer, p_amount_cents),
      COALESCE((p_protection->>'user_profit_cents')::integer, 0),
      COALESCE((p_protection->>'platform_deduction_cents')::integer, 0),
      COALESCE((p_protection->>'platform_profit_cents')::integer, 0),
      COALESCE((p_protection->>'locked_deduction_cents')::integer, 0),
      COALESCE((p_protection->>'exchange_fee_cents')::integer, 0),
      COALESCE((p_protection->>'exchange_profit_net_cents')::integer, 0),
      p_balance_before,
      p_balance_after,
      v_prot_meta
    );
  END IF;

  PERFORM set_config('session_replication_role', 'origin', true);

  RETURN jsonb_build_object(
    'ok', true,
    'protectionId', v_pid,
    'marketType', upper(COALESCE(p_market_type, 'LAY')),
    'amountCents', p_amount_cents,
    'balanceAfterCents', p_balance_after,
    'lockType', v_lock_type,
    'fix', 'integridade-debito-v3'
  );
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('session_replication_role', 'origin', true);
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.arbishield_create_protection(
  uuid, uuid, text, integer, numeric, text, text, integer, integer, jsonb, jsonb, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.arbishield_create_protection(
  uuid, uuid, text, integer, numeric, text, text, integer, integer, jsonb, jsonb, text, uuid
) TO service_role;

GRANT EXECUTE ON FUNCTION public.arbishield_create_protection(
  uuid, uuid, text, integer, numeric, text, text, integer, integer, jsonb, jsonb, text, uuid
) TO postgres;

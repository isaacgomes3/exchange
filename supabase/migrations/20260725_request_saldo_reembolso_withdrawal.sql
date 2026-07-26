-- Saque do Saldo Reembolso via RPC (não depende do shim Node).
-- SECURITY DEFINER: debita deduction_balance_cents e cria withdrawals.pending.

CREATE OR REPLACE FUNCTION public.request_saldo_reembolso_withdrawal(
  p_amount_cents bigint,
  p_pix_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pix text;
  v_available bigint;
  v_after bigint;
  v_open uuid;
  v_row public.withdrawals%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_open
  FROM public.withdrawals
  WHERE user_id = v_uid
    AND status IN ('pending', 'approved', 'processing')
    AND (
      upper(coalesce(metadata->>'origin', '')) IN (
        'SALDO_REEMBOLSO_WITHDRAWAL',
        'DEDUCTION_WITHDRAWAL',
        'SALDO_DEDUCAO_WITHDRAWAL',
        'REFUND_BALANCE_WITHDRAWAL'
      )
      OR upper(coalesce(metadata->>'request_type', '')) IN (
        'SALDO_REEMBOLSO_WITHDRAWAL',
        'DEDUCTION_WITHDRAWAL'
      )
    )
  LIMIT 1
  FOR UPDATE;

  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'Você já possui um saque de Saldo Reembolso em análise.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT deduction_balance_cents,
         coalesce(nullif(btrim(p_pix_key), ''), nullif(btrim(pix_key), ''))
    INTO v_available, v_pix
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil não encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_pix IS NULL OR v_pix = '' THEN
    RAISE EXCEPTION 'Cadastre sua chave Pix no Perfil antes de sacar o Saldo Reembolso.'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_cents > coalesce(v_available, 0) THEN
    RAISE EXCEPTION 'Saldo Reembolso insuficiente (disponível %)',
      to_char(coalesce(v_available, 0) / 100.0, 'FM999999990.00')
      USING ERRCODE = 'P0001';
  END IF;

  v_after := v_available - p_amount_cents;

  UPDATE public.profiles
  SET deduction_balance_cents = v_after,
      updated_at = now()
  WHERE id = v_uid;

  INSERT INTO public.withdrawals (user_id, amount_cents, pix_key, status, metadata)
  VALUES (
    v_uid,
    p_amount_cents,
    v_pix,
    'pending',
    jsonb_build_object(
      'origin', 'SALDO_REEMBOLSO_WITHDRAWAL',
      'bucket', 'deduction_balance_cents',
      'label', 'Saldo Reembolso',
      'note', 'Saque Saldo Reembolso (stake + dedução ArbiShield)'
    )
  )
  RETURNING * INTO v_row;

  BEGIN
    INSERT INTO public.wallet_transactions (user_id, type, amount_cents, ref, metadata)
    VALUES (
      v_uid,
      'withdrawal_request',
      -p_amount_cents,
      v_row.id::text,
      jsonb_build_object(
        'origin', 'SALDO_REEMBOLSO_WITHDRAWAL',
        'bucket', 'deduction_balance_cents',
        'label', 'Saldo Reembolso'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'withdrawal_id', v_row.id,
    'amountCents', p_amount_cents,
    'availableAfter', v_after
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_saldo_reembolso_withdrawal(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_saldo_reembolso_withdrawal(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_saldo_reembolso_withdrawal(bigint, text) TO service_role;

COMMENT ON FUNCTION public.request_saldo_reembolso_withdrawal(bigint, text) IS
  'Saque do Saldo Reembolso (deduction_balance_cents). Independente do shim Node.';

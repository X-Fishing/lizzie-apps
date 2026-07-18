-- ════════════════════════════════════════════════════════════════════
-- 0022 — Excluir lançamento financeiro: só admin pode apagar linha
--        já paga ou estornada. COMO APLICAR: Supabase → SQL Editor → Run.
-- ════════════════════════════════════════════════════════════════════
-- A policy flan_write (0009) é FOR ALL e exige is_gestor() — permissiva,
-- então sozinha deixaria func_completo apagar qualquer lançamento.
-- Adicionamos uma policy RESTRICTIVE de DELETE: policies restritivas fazem
-- AND com as permissivas. Resultado do DELETE = is_gestor() AND (esta).
--   • admin → pode apagar qualquer linha (botão "Excluir" da tela).
--   • gestor (func_completo) → só apaga pendência ainda aberta e não
--     estornada — que é exatamente o delete técnico interno do fluxo de
--     registrar recebimento (financeiro.js). O histórico pago/estornado
--     fica protegido para não-admin.
drop policy if exists flan_delete_admin on public.financeiro_lancamentos;
create policy flan_delete_admin on public.financeiro_lancamentos
  as restrictive for delete to authenticated
  using (
    public.is_admin()
    or (pago = false and coalesce(estornado, false) = false)
  );

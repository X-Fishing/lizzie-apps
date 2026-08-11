-- 0049 — Verniz padrão (R$/kg) por categoria + valores iniciais de banho.
--
-- Contexto: banho (milésimos) já existia por categoria (categorias.banho_padrao,
-- migração 0015). Verniz nunca teve padrão — ficava sempre 0 na Entrada de
-- Mercadoria e quase nunca era preenchido. Verniz passa a valer R$ 390/kg por
-- padrão em TODAS as categorias (decisão do Rondon: entra no custo de toda
-- peça lançada daqui pra frente; quem não leva verniz zera manualmente na
-- tela de Precificação).
--
-- Numeração: 0043-0046 são de outra sessão (não versionadas neste repo,
-- ver PENDENCIAS.md); 0047 e 0048 já rodaram.

alter table public.categorias
  add column if not exists verniz_padrao numeric(12,4) not null default 390;

-- Valores de banho passados pelo Rondon, casando por nome (a base tem os
-- nomes no plural: "Brincos", "Anéis"...) — usa `like` com o termo no
-- singular no início do nome, sem diferenciar maiúscula/acento.
do $$
declare
  v_termo text;
  v_valor numeric;
  v_pares text[][] := array[
    array['brinco', '2'],
    array['anel',   '5'],
    array['pulseira', '3'],
    array['colar', '3'],
    array['conjunto', '3'],
    array['piercing', '3'],
    array['pingente', '3'],
    array['tornozeleira', '3'],
    array['berloque', '3'],
    array['bracelete', '3'],
    array['choker', '3']
  ];
  v_par text[];
begin
  foreach v_par slice 1 in array v_pares loop
    v_termo := v_par[1];
    v_valor := v_par[2]::numeric;
    update public.categorias
      set banho_padrao = v_valor
      where lower(nome) like v_termo || '%'
         or lower(nome) like '%' || v_termo || 's%'; -- pega plural mesmo se não começar pelo termo
  end loop;
end $$;

-- Conferência manual: rode este select depois e confirme quais categorias
-- casaram (banho_padrao != 0) e quais ficaram de fora (precisam de ajuste
-- manual na tela de Precificação).
select nome, banho_padrao, verniz_padrao from public.categorias order by nome;

select pg_notify('pgrst', 'reload schema');

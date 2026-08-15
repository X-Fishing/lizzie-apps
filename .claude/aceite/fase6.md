# Fase 6 — Critérios de aceite

A fidelidade passa a **somar as vendas dentro do ciclo da revendedora** (a maleta).
Migração: `supabase/migrations/0057_fidelidade_ciclo.sql` — **não** aplicada no banco;
avalie o SQL por leitura e pelo script de teste `supabase/testes/0057-fidelidade-ciclo.sql`.

Contexto mínimo: app PWA (Vite + JS puro + Supabase) da Lizzie Semijoias.
Regra anterior: 1 selo a cada R$ 150 CHEIOS de CADA venda (`floor(valor_total/150)`),
com o troco de cada venda descartado. 10 selos = prêmio de R$ 300.

## Critérios

### A regra
1. Duas vendas de R$ 75 para a mesma cliente **na mesma maleta** geram **1 selo**.
2. As mesmas duas vendas em **maletas diferentes** geram **0 selos**.
3. Uma venda única de R$ 450 continua gerando **3 selos** (a regra antiga não regrediu).
4. Cliente com 9 selos + venda de R$ 300: a cartela fecha, nasce prêmio pendente e a
   cartela nova começa com o excedente de selos (comportamento da 0030 preservado).
5. Venda **sem maleta** se comporta como antes: cada venda é seu próprio balde.
6. `VALOR_POR_SELO` continua **150** e o prêmio continua **R$ 300 a cada 10 selos**.

### O ciclo tem de chegar no INSERT
7. A venda é gravada **já com `maleta_id`**. O gatilho de selos é `AFTER INSERT`: se a
   maleta só for gravada depois, os selos caem no ciclo errado. Um `UPDATE` posterior de
   `maleta_id` no front é REPROVAÇÃO.
8. A maleta ativa é resolvida **no servidor** (não pode depender de o front mandar o id).
   A maleta resolvida tem de ser a da MESMA pessoa gravada em `vendas.revendedora_id`.

   > Correção deste critério (era mal formulado): a versão original exigia que "venda
   > lançada por staff caia na maleta da mostruarista". Isso é impossível e não era o
   > comportamento anterior — `registrar_venda` sempre grava `revendedora_id = auth.uid()`,
   > então a venda feita por staff **é do staff**, e não existe maleta de outra pessoa a
   > que ela devesse pertencer. Venda de staff fica sem maleta e vira balde de venda
   > única, exatamente como antes desta migração. O que importa verificar é a coerência
   > entre a maleta escolhida e o `revendedora_id` gravado.
9. Se o front mandar um `p_maleta_id` que **não é da própria pessoa**, ele é ignorado
   (senão a venda entraria no ciclo de outra revendedora).

### Sem retroatividade
10. Aplicar a migração **não muda nenhum selo nem prêmio existente**. Deve existir um
    diagnóstico no arquivo para conferir isso antes/depois.
11. Não há backfill das tabelas novas — elas nascem vazias.

### Integridade
12. Processar a MESMA venda duas vezes credita selo uma vez só. A guarda de idempotência
    **não** pode ser "esta venda já tem selo?", porque com acúmulo uma venda pode
    legitimamente gerar 0 selos e ainda assim já ter sido contada.
13. O lock por cliente é tomado **antes** de ler o acumulado. Ler antes de travar deixa
    duas vendas simultâneas creditarem o mesmo delta (read-modify-write).
14. Excluir uma venda tira o valor dela do balde e devolve os selos que ainda estão em
    cartela **aberta**. Prêmio já resgatado nunca é desfeito.
15. Corrigir a cliente de uma venda (reaponte) tira a venda do balde da cliente antiga
    antes de apagar os selos — senão a cliente nova não receberia nada.
16. Ajuste manual ±1 do admin não é comido nem apagado pelo acúmulo.
17. As tabelas novas têm RLS ligada, **nenhuma policy**, e `revoke` de `anon`/`authenticated`
    — não podem ser legíveis pelo PostgREST com token de revendedora.
18. Erro na fidelidade **nunca** derruba a venda.
19. A migração é idempotente, faz `drop function` de todas as assinaturas antigas de
    `registrar_venda`, tem `revoke`/`grant` explícitos, `search_path = public`, e termina
    com `select pg_notify('pgrst','reload schema')`.

### A regra tem de ser explicável na tela
20. Quando a venda gera 0 selos porque o valor ficou acumulado, o modal pós-venda diz
    **quanto falta** para o próximo selo — "+0 selos" sozinho parece defeito. E essa
    mensagem **não pode aparecer em venda sem maleta**: ali o troco não é guardado (o
    balde é a própria venda), então dizer "faltam R$ X nesta maleta" seria mentira.
21. A mensagem de WhatsApp dos selos não diz "+0 selos": ela explica que a compra está
    contando.
22. A tela da cliente mostra o saldo acumulado no ciclo atual e quanto falta.

### Sanidade
23. `npm run build` e `npm run lint` passam.
24. Os parâmetros enviados em `sb.rpc('registrar_venda', {...})` batem exatamente com os
    declarados na 0057 (nome e quantidade).
25. Toda função usada em `onclick=` está registrada no `Object.assign(window, ...)`.

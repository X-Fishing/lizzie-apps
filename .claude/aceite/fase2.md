# Fase 2 — Critérios de aceite

O aniversário da CLIENTE FINAL passa a ser **dia e mês, sem ano**, e deixa de ser
obrigatório em qualquer lugar do app.

Contexto mínimo: app PWA (Vite + JS puro + Supabase) da Lizzie Semijoias.
Migração nova: `supabase/migrations/0055_aniversario_dia_mes.sql`.
A migração **não** foi aplicada no banco ainda — avalie o SQL por leitura, não por execução.

## Critérios

### Comportamento
1. Ao finalizar uma venda no PDV **sem** preencher o aniversário, a venda é aceita —
   nenhuma validação de front barra o envio por causa desse campo.
2. Ao abrir uma garantia como revendedora **sem** preencher o aniversário, a garantia é
   aceita. A exigência de telefone válido para a revendedora **continua existindo**.
3. Nenhum campo de aniversário de cliente aceita ou exibe ano: todos usam máscara `dd/mm`
   (`maskDiaMes`), `placeholder="dd/mm"` e `maxlength="5"`. São 4 campos: `#f-nasc` (PDV),
   `#g-nasc` (garantia), `#cli-nasc` (CRUD de clientes), `#cv-nasc` (corrigir cliente da venda).
4. `29/02` é aceito como aniversário válido (sem ano, não há como ser inválido).
   `31/04`, `00/05`, `12/13` e `07/2003` são rejeitados.
5. Onde o aniversário é apenas EXIBIDO, aparece no formato `dd/mm` — nunca `dd/mm/aaaa`
   nem `dd/mm/` com sobra.
6. O Bônus de Aniversário continua listando revendedoras E clientes do mês corrente,
   ordenado por dia.

### Dado / banco
7. A data de nascimento da **REVENDEDORA** (`revendedora_docs.data_nascimento`, usada no
   contrato) **não pode** ter sido alterada — ela continua sendo `date` com ano, com
   máscara `dd/mm/aaaa`. Qualquer mudança ali é REPROVAÇÃO.
8. Nenhum código em `src/` lê ou escreve `clientes.data_nascimento`,
   `vendas.nascimento_cliente` ou `garantias.nascimento_cliente`.
9. A migração 0055 é idempotente: rodá-la duas vezes não perde dado nem dá erro
   (em especial: o backfill não pode tentar ler uma coluna já derrubada).
10. A migração faz backfill do dia/mês a partir da coluna antiga ANTES de derrubá-la.
11. Toda função SQL redefinida na 0055 tem `drop function` de TODAS as assinaturas
    antigas antes do `create` (senão o PostgREST fica com overload ambíguo), mais
    `revoke`/`grant` explícitos e `set search_path = public`.
12. A migração termina com `select pg_notify('pgrst','reload schema')`.
13. `buscar_cliente_por_telefone` continua escopada por papel — staff vê todas, a
    revendedora só acha cliente para quem ELA já vendeu. Perder esse escopo é
    REPROVAÇÃO (é uma regressão de vazamento de dado já corrigida antes).
14. `cliente_upsert_para_venda` continua: telefone inválido → retorna null; nome só
    ENRIQUECE (nunca troca por um nome diferente); aniversário só preenche se estava vazio.
15. `registrar_venda` preserva tudo que já fazia: rateio de formas de pagamento, regra
    `Fiado%` não conta como recebido, derivação de `valor_pago`/`status` no servidor,
    inserção de itens, baixa de estoque e recebimentos.

### Sanidade
16. `npm run build` e `npm run lint` passam.
17. Os parâmetros que o front envia nas RPCs batem exatamente com os nomes e a ordem
    declarados na migração 0055 (`registrar_venda`, `completar_venda_cliente`).

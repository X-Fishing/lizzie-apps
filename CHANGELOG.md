# Changelog — Lizzie Apps

Registro das entregas por sessão de trabalho. As regras de negócio consolidadas
ficam no `CLAUDE.md`; aqui fica o histórico do que mudou e quando.

---

## Sessão — Agosto/2026

**Sincronização de estoque App ↔ Site (Nuvemshop)**

O app passa a controlar sozinho o estoque visível no site. O Bling **não**
participa: `produtos.estoque_qtd` é a fonte de verdade.

- **Regra central**: `estoque no site = estoque_qtd − Σ(enviada − vendida − devolvida)` dos consignados **ativos**. Peça em maleta com revendedora nunca aparece disponível no site; volta a contar na devolução ou no fim do catálogo.
  - O casamento com `consignados` é por `produto_id` **ou** pelo SKU em `referencia` — peça importada do Bling tem `produto_id` nulo, e olhar só o id deixaria a peça publicada indevidamente.
- **Fila + cron**: triggers em `consignados` / `produtos` / `produto_variacoes` enfileiram o produto; a Edge Function `nuvemshop-sync-estoque` processa em lote a cada 2 min (respeita rate limit, 5 tentativas e desiste para não travar a fila).
- **Venda no site** dá baixa em `estoque_qtd` pelo webhook `order/paid` (não `order/created`). Idempotente e atômico: reivindicação do evento + baixa de todos os itens numa transação só, então reenvio da Nuvemshop não desconta duas vezes.
- **Tela nova "Loja do site"** (Configurações, admin): conexão, URL do webhook para copiar e vínculo manual produto ↔ variante da loja.
- **Coluna "Site"** na tela de Produtos: bolinha de status (ok / pendente / erro com o motivo / sem vínculo), "Sincronizar agora" por linha e "Sincronizar site" no topo.
- **Segurança**: o `access_token` nunca volta pro navegador (a tela só mostra "Conectado desde..."); `nuvemshop_tokens` e `nuvemshop_sync_queue` com RLS e zero policies; webhook exige HMAC (`NUVEMSHOP_CLIENT_SECRET`) e recusa se o secret não estiver configurado.

**Como colocar no ar** (nesta ordem):
1. SQL Editor → rodar `nuvemshop-estoque-schema.sql` inteiro.
2. Secrets: `npx supabase secrets set NUVEMSHOP_CLIENT_SECRET=...` (obrigatório pro webhook).
3. `npx supabase functions deploy nuvemshop-set-token nuvemshop-sync-estoque nuvemshop-buscar-produtos nuvemshop-webhook-pedido`
4. App → Configurações → Loja do site: `store_id` + access token.
5. Admin da Nuvemshop → Configurações → Notificações: cadastrar a URL do webhook no evento `order/paid`.
6. Agendar o cron: bloco comentado no fim do `nuvemshop-estoque-schema.sql` (precisa colar a service role key à mão — por isso não fica no arquivo).
7. Vincular os produtos na tela nova (os `sem vínculo` aparecem listados).

---

## Sessão — Julho/2026

### Features grandes

**1. Programa de Fidelidade (cartela de selos) + Certificado de Garantia por WhatsApp**
- 1 selo a cada R$150 cheios da venda (`floor(total/150)`). Cartela de 10 selos da **cliente final** (chave = telefone), compartilhada entre revendedoras. Ao completar 10 → prêmio de **R$300** (retirada na loja).
- **Excedente acumula**: ao completar, o que passar vira o começo da cartela nova (ex.: 9 selos + R$450 → completa + prêmio + nova cartela com 2).
- **Tela Fidelidade**: cartela visual de 10 casinhas, busca por cliente, extrato de selos. Revendedora vê só as clientes dela (RLS); resgate do prêmio só gestor.
- **Modal pós-venda**: mostra os selos ganhos + botões de WhatsApp ao finalizar a venda.
- **Certificado de garantia** (validade 1 ano): imagem gerada no app via Canvas. No celular envia a imagem pelo compartilhamento nativo do WhatsApp; no PC manda o link. Botão de reenvio na tela de Pagamentos.
- **WhatsApp**: modo grátis (wa.me / share nativo). Edge Function `whatsapp-enviar` já existe para envio automático (Meta/Z-API) caso se opte por um provedor pago — hoje não é usada.

**2. Autocomplete da cliente pelo telefone (PDV)**
- Telefone virou o **1º campo** da finalização, com foco automático.
- Ao digitar, puxa nome + data de nascimento + progresso da cartela ("Cliente já cadastrada · X/10 selos"). Telefone novo → "Nova cliente".
- Telefone é a chave: editar o nome **atualiza** o cadastro, nunca duplica.

**3. Maletas (entidade com regras)**
- Status `ativa` / `aguardando` / `finalizada`; máx. 2 em aberto por revendedora, 1 ativa.
- **Lançar Maleta** sempre pergunta "Continuar maleta" ou "Nova maleta" (nova bloqueada no limite de 2).
- Colunas: Descrição · Código · Quantidade · Preço un · Preço total.
- Cada bipe = 1 linha (1 unidade); campo de bipe como "última linha" (estilo Bling) com auto-scroll.
- Catálogo da revendedora mostra **só a maleta ativa**.
- Finalizar catálogo: ativa → finalizada, e aguardando → ativa (a troca).
- "Excluir maleta aguardando" (antigo "Deletar catálogo") **nunca toca a ativa**.
- **Backfill + vínculo automático**: importação do Bling, novo consignado manual e `sincronizar_maleta` agora anexam `maleta_id`.

**4. Produtos / Estoque**
- Cadastro de produtos próprio (catálogo-mestre) validado e no ar.
- Filtro e busca por **coleção** na lista de produtos (badge de coleção na linha).
- **Importar foto do Bling por SKU** (Edge Function `bling-produto-foto` + botão no produto).

**5. Perfil duplo no celular**
- Funcionária que também é revendedora escolhe ao entrar (Funcionária ou Revendedora), só no celular; no PC entra como funcionária. Detecção automática.

**6. Contas a Pagar — redesign**
- 4 KPI cards (Total do mês / Pago / Em aberto / Atrasado), botão "+ Nova Conta", navegação de mês + abas, busca à direita, rodapé de totais e toggle "Pago?" como última coluna.

### Ajustes de UX / correções
- Toasts de sucesso silenciados (erros e avisos continuam). `toast(msg, 'erro')` força exibição.
- Botão de editar (categorias/produtos) ficou visível (era branco em fundo claro).
- Filtro "apenas vendidos" no catálogo.
- PWA se atualiza sozinho no celular (checa a cada 60s e ao voltar o foco).
- Limpeza: removida subpasta duplicada `lizzie-apps/`, adicionada ao `.gitignore`; criado `CLAUDE.md`.

### Migrations aplicadas
| # | O que faz |
|---|---|
| 0028 | Tabelas de fidelidade + RLS + `vendas.cliente_id` + `fidelidade_status()` + storage do certificado |
| 0029 | `cliente_upsert_para_venda`, trigger de selos, `registrar_venda` v3 (jsonb) |
| 0030 | Excedente de selos passa a acumular na próxima cartela |
| 0031 | `buscar_cliente_por_telefone` (autocomplete) |
| 0032 | Garante `registrar_venda` retornando jsonb (fix do modal) |
| 0033 | Autocomplete traz nascimento; upsert atualiza o nome |

Outros SQL no repo: `maletas-schema.sql`, `maletas-backfill.sql`, `produtos-schema.sql`, `db-functions.sql` (atualizado).

### Incidentes resolvidos
- **Netlify parou de publicar**: tinha perdido o acesso ao repositório GitHub ("Host key verification failed"). Resolvido reconectando o repositório no painel do Netlify.
- **Revendedoras apareciam "sem maleta"**: catálogos legados (importados do Bling) não tinham linha em `maletas`. Resolvido com backfill + vínculo automático nos caminhos de criação.

### Em aberto (opcionais)
- **WhatsApp automático** (sem clique): ativar provedor pago (Meta/Z-API) + deploy da `whatsapp-enviar`.
- **Arte oficial do certificado**: subir `templates/garantia.png` no bucket `lizzie-fotos` (posições ajustáveis em `src/garantia-template.js`).
- **Selos retroativos** de vendas antigas (hoje: não aplicados).

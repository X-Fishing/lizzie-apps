# Prompt: Integração App ↔ Catálogo (link da maleta por revendedora)

## Como rodar

Este trabalho mexe em DOIS repositórios. Abra o terminal em `D:\lizzie-apps` e rode:

```
claude --add-dir "D:\Marketing Lizzie"
```

Depois cole o prompt abaixo.

---

Você vai conectar o app de gestão (`D:\lizzie-apps\index.html`, Supabase) ao site-catálogo estático (`D:\Marketing Lizzie\_build_catalog_web.js` → lizzie-catalogo.netlify.app). Objetivo: cada revendedora ganha um link público exclusivo do catálogo mostrando SÓ as peças disponíveis na maleta dela; quando uma peça é vendida no app, ela some do link automaticamente.

**A chave da integração já existe**: o catálogo nomeia as fotos pelo SKU do Bling (`fotos/18548.jpg` → referência 18548) e a tabela `consignados` do app guarda esse mesmo SKU em `referencia` (vem de `it.codigo` na importação do Bling). A ponte é `consignados.referencia = SKU do catálogo`.

## Parte 1 — Banco (SQL, gerar arquivo idempotente para eu rodar no Supabase)

1. `alter table profiles add column if not exists share_token uuid unique default gen_random_uuid();` (backfill para linhas existentes onde for null).
2. RPC pública `maleta_publica(p_token uuid)` — `security definer`, `set search_path = public`, retorna APENAS para o profile aprovado dono do token:
   - `primeiro_nome` (só o primeiro nome da revendedora), `telefone` (para o botão WhatsApp — a revendedora compartilha o link por vontade própria, o telefone dela é o canal de compra)
   - Itens: `referencia`, `descricao`, `preco_venda`, `disponivel` (enviada − vendida − devolvida) de `consignados` com `status='ativo'` e disponível > 0.
   - Se token inválido/não aprovada: retorna vazio (não vazar existência).
   - `grant execute to anon`. NUNCA retornar: sobrenome completo, cidade, e-mail, custos, ids internos, dados de clientes.
3. RPC `regenerar_share_token()` — invoker, regenera o token do próprio usuário logado (para revogar link vazado).

## Parte 2 — Catálogo (`D:\Marketing Lizzie\_build_catalog_web.js`)

1. **Gerar `produtos.json` no build**: array com todos os produtos de todas as categorias — `{ sku, nome, preco, categoria, subcategoria, foto }`. Publicar junto com o site.
2. **Nova página `/maleta`** (gerada no build, mesma identidade visual das outras):
   - Lê `?t=<token>` da URL. Sem token → mensagem gentil "link inválido" com contato da Lizzie.
   - Chama a RPC via REST: `POST https://qoouzjntyfzcxnwjksiu.supabase.co/rest/v1/rpc/maleta_publica` com header `apikey` (anon key — pedir para eu colar, NÃO inventar).
   - Cruza com `produtos.json` pelo SKU e renderiza só as peças da maleta, agrupadas por categoria, com os mesmos cards do catálogo.
   - **Preço**: usar `preco_venda` do app (é o preço real da maleta); se null, cai no preço do catálogo.
   - **Peça sem foto no catálogo** (SKU não encontrado em produtos.json): renderizar card com placeholder elegante + `descricao` e preço vindos do app — não pode simplesmente sumir.
   - Cabeçalho: "Maleta de {primeiro_nome} · Lizzie Semijoias".
   - **Botão WhatsApp em cada card**: `wa.me/55<telefone>?text=Oi {primeiro_nome}! Me interessei pela peça {nome} (ref {sku}) do seu catálogo Lizzie 💛` — a cliente fala direto com a revendedora.
   - `noindex,nofollow` como as demais páginas. Sem cache agressivo do JSON da RPC (buscar a cada carga; os assets estáticos podem manter cache).
3. **Não quebrar nada** do catálogo atual (páginas por categoria continuam iguais).

## Parte 3 — App (`D:\lizzie-apps\index.html`)

1. Na tela **Catálogo da revendedora**, botão destacado "🔗 Divulgar minha maleta" abrindo painel embutido (padrão do app, sem confirm/prompt nativos) com:
   - O link `https://lizzie-catalogo.netlify.app/maleta?t=<share_token>` (buscar o token do próprio profile)
   - Botões: **Copiar link**, **Enviar no WhatsApp** (`wa.me/?text=` com mensagem pronta apresentando o catálogo), e **QR Code** (gerar client-side, sem lib externa pesada — pode usar um <canvas> com implementação mínima ou API do próprio navegador se disponível; se precisar de lib, algo < 10 KB via CDN).
   - Link menor "Gerar novo link" → chama `regenerar_share_token()` com confirmação embutida (o link antigo para de funcionar).
2. Na visão **admin** do catálogo de cada revendedora, mostrar o mesmo link (admin pode enviar para a revendedora).
3. Aplicar `esc()` em tudo que renderizar.

## Parte 4 — Aproveitar e consertar no repositório do catálogo

1. `node_modules` está commitado → adicionar ao `.gitignore` e `git rm -r --cached node_modules`.
2. Apagar `_build_catalog_web.js.bak`.
3. Produtos sem nome (título = SKU, ex: 20020, 21330, 20590) e sem preço (20611): listar todos num relatório `PENDENCIAS-CATALOGO.md` para o Rondon corrigir na origem dos dados — não inventar nomes.

## Verificação

1. Rodar o build do catálogo, conferir `/maleta?t=<token real>` local: aparecem só as peças ativas disponíveis da revendedora de teste.
2. Vender uma peça no app → recarregar o link → a peça sumiu (se a última unidade foi vendida).
3. Token inválido → página gentil, sem erro de console, sem vazar dados.
4. Confirmar na resposta da RPC (aba Network) que só vêm os campos permitidos.
5. Testar botão WhatsApp do card e o QR Code no celular.
6. Commits separados por parte, mensagens em português no padrão do repo. O SQL fica commitado em `db-functions.sql` ou arquivo novo `sql/` no lizzie-apps.

## Fase 2 (não fazer agora — só deixar anotado no fim)

- Contador de visualizações do link da maleta (tabela simples, incremento na RPC).
- Modo "encomenda": cliente marca interesse e a revendedora vê a lista no app.
- Otimizar imagens do catálogo no build (sharp: resize + webp) — hoje as fotos vão no tamanho original.
- Auditoria XSS das ~30 interpolações `innerHTML` novas do app + invalidação de cache (`allConsignados`/`allGarantias`) após operações + debounce na busca do catálogo interno.
- Migração Vite (PROMPT-VITE-MODULOS.md) — fazer ANTES se o arquivo passar de ~10k linhas.

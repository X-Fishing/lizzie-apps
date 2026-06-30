# Instruções para o Claude (Cowork) — Projeto Lizzie Apps

## REGRA PRINCIPAL — NÃO CODAR AQUI
É **proibido editar/criar arquivos de código diretamente nesta pasta** pelo Cowork.

O Claude do Cowork deve **sempre gerar um PROMPT** para ser executado pelo **Claude/Copilot dentro do VS Code**. O fluxo é:

1. Entender o pedido e planejar.
2. Entregar um **arquivo PROMPT** (estilo `PROMPT-LAYOUT.md` / `PROMPT-PRODUTOS.md`) com instruções claras, passo a passo, para o agente do VS Code aplicar.
3. Não usar Write/Edit em arquivos `.js`, `.html`, `.css`, `.sql` etc. da feature. A implementação acontece no VS Code.

Exceção: arquivos de **documentação/instrução/PROMPT** (como este `CLAUDE.md` e os `PROMPT-*.md`) podem ser criados pelo Cowork.

## Contexto do projeto
- App PWA de gestão da Lizzie Semijoias (Vite + JS puro + Supabase).
- Dois públicos por papel: funcionários/gestão e revendedoras.
- Migração gradual para fora do Bling (catálogo de produtos próprio).
- Deploy: Netlify (push em `origin/main` publica). Variáveis `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` ficam no Netlify e no `.env` local (não commitar `.env`).

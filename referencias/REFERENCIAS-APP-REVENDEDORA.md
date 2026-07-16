# Referências visuais — App da revendedora, Parabéns e Garantia

> Catálogo das referências que o Rondon enviou em 16/07. As imagens vieram como screenshots
> no chat (não como arquivos), então **salve os originais nesta pasta** com os nomes sugeridos
> abaixo, para consulta futura nos prompts.
>
> Arquivos (já salvos nesta pasta):
> - `ref-app-menu.jpeg` — menu lateral do app concorrente
> - `ref-app-home.jpeg` — home (cards) do app concorrente
> - `ref-app-dashboard.jpeg` — dashboard/topo do app concorrente
> - `ref-parabens-belladai.jpeg` — post de parabéns (BellaDai)
> - `ref-garantia-veridiana.jpeg` — certificado de garantia (Veridiana Quirino)

---

## 1. LAYOUT DO APP DA REVENDEDORA (3 telas de um app concorrente)
Uso: inspiração para a área da revendedora no app da Lizzie.

### Menu lateral (`ref-app-menu.png`)
Topo com **foto + nome + ID** da revendedora. Itens de menu com ícone de linha (rosé/coral sobre branco):
Início · Mensagens (com badge de contador) · Meu inventário · Minhas vendas · Histórico de vendas · Conferência · NFs · Meus clientes · Garantias · Assistências · Material de Divulgação · Telefones · Minha conta.
- **Aproveitar:** ícone + label limpos; badge de não-lidas em Mensagens; "Material de Divulgação" e "Telefones" como itens próprios; "Minha conta" no rodapé.
- Estética: fundo branco, ícones finos coral, item ativo em coral com barra lateral.

### Home / cards (`ref-app-home.png`)
- Card "Material de Divulgação — Fotos dos modelos da sua maleta" com seta `>`.
- Bloco motivacional "🚀 Você consegue!" com barra de progresso "Total".
- Card "COMPRAS ATACADO — Veja aqui" (link).
- Card "Saldo do showroom".
- **Aproveitar:** o bloco de progresso do ciclo (meta de vendas) e o atalho para o material de divulgação (casa com nossa importação de fotos).

### Dashboard / topo (`ref-app-dashboard.png`)
- Header verde-escuro com **foto em anel de progresso**, saudação "Olá, {nome}!", **faixa/tier "Gold Prime ⭐⭐"**, período do ciclo "10/07/26 a 10/08/26", "Ciclo: 6 de 31", "Acerto: 10/08 às 10:00".
- 4 cards de métrica: **Inventário (247 peças)**, **Vendidos**, **A pagar**, **Meu Lucro (Ver detalhes >)**.
- **Aproveitar (encaixa com o que já temos):** o header com anel de progresso + tier + contagem de ciclo ("Ciclo X de 35" — nós usamos ciclo de 35 dias) + data de acerto; os 4 KPIs (inventário / vendidos / a pagar / lucro). Isso conversa direto com nosso módulo de consignados e faixas de comissão (30%/35%).
- Mapear "tier" às nossas **Faixas de Comissão** (ex.: Prata/Ouro/Gold Prime conforme atingimento).

---

## 2. PARABÉNS PARA REVENDEDORAS (`ref-parabens-belladai.png`)
Uso: modelo de **envio automático de parabéns** (aniversário / conquista / marco de vendas).
- Post rosa, título manuscrito grande "Parabéns, {Nome}!", foto da revendedora em moldura polaroid, texto caloroso de reconhecimento.
- **Cupom/ticket destacado:** "Você ganhou **R$ 80** em peças da Lizzie!" (voucher de bonificação).
- Assinatura "Com carinho, ♡ equipe Lizzie".
- **Aproveitar para o disparo automático:** template com {nome} + {foto} + {valor_bonus} + mensagem. Casa com o item de menu **Marketing → Bônus** (que criamos como "em breve") e com aniversários. Formato quadrado (1080×1080) para WhatsApp/Instagram.
- Elementos de marca: rosa Lizzie, coração, tipografia manuscrita para o nome.

---

## 3. CERTIFICADO DE GARANTIA (`ref-garantia-veridiana.png`)
Uso: modelo para o **envio automático de garantia** (hoje temos o módulo Garantias no app).
- Cabeçalho decorado floral "✦ Certificado de Garantia ✦" + "validade de 6 meses a partir da data de compra".
- **Quadro do produto:** foto + **código (5164055 / cl1729)** + **banho (Ouro)** + **Validade: 23/11/2026**; **Nome do cliente** (Gabriela Machado); **CPF**; **descrição** (Mira/Canutilhos/letra G/Madrepérola). Nota "*imagem meramente ilustrativa".
- Blocos de texto: **Política de Troca** (30 dias), **Peças em Garantia** (defeito de fabricação, perda do banho, ruptura de fecho), **Política de Garantia** (6 meses).
- Coluna direita com **ícones de cuidado** ("Evite contato com…", "Evite mar/piscina", "Tire ao dormir", "Retire antes de procedimento estético") e **pós-uso** (guardar separado, limpar com flanela).
- Rodapé com redes sociais + endereços.
- **Aproveitar para o gerador de garantia da Lizzie:** os campos que preenchem automático = **código da peça, banho, validade (compra + 6 meses), nome + CPF do cliente, descrição**. Layout: quadro do produto à esquerda, dicas de cuidado à direita. Substituir marca/endereços/redes pelos da Lizzie. Formato para imprimir/enviar por WhatsApp (imagem ou PDF).
- Conecta com o certificado que já geramos no fechamento (mesma técnica `window.print`/imagem).

---

## Próximos passos possíveis (quando o Rondon quiser prompt)
1. **Certificado de garantia da Lizzie** — gerador que puxa dados da peça/cliente e monta a arte (base neste modelo).
2. **Card de parabéns automático** — template + disparo (aniversário / marco de vendas) via Marketing → Bônus.
3. **Header do dashboard da revendedora** — anel de progresso + tier (Faixas de Comissão) + ciclo + acerto + 4 KPIs.

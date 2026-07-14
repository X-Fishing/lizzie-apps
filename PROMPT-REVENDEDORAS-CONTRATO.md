# PROMPT 2 — Gerar Contrato de Revenda em PDF (preenchido automaticamente)

> Rodar **depois** do Prompt 1 (cadastro completo). Pasta **`D:\lizzie-apps`**. Branch: `feat/revendedoras-contrato`.
> Arquivos: **`src/admin.js`** (botão + geração) + um bloco de impressão no `index.html`. `npm run lint`/`build` verdes.

## Objetivo
No formulário de revendedora, um botão **"Gerar Contrato"** que preenche o **Contrato de Revenda em Consignação** da Lizzie com os dados dela e gera um **PDF pronto para impressão**.

## Como gerar o PDF (use o padrão que já existe no projeto)
O app já gera PDF por **`window.print()` com CSS de impressão** (ver `gerarPdfFechamento()` em `consignados.js`, que usa um container oculto + `@media print` + `window.print()`). **Use essa mesma técnica** — é ideal para documento de texto longo com boa formatação, e não precisa de biblioteca. NÃO use jsPDF aqui (ele é melhor para tabelas, não para contrato corrido).

Estrutura:
1. Um container oculto `div#contrato-print` no `index.html` (fora do fluxo, exibido só na impressão via `@media print`).
2. `gerarContrato(revId)` monta o HTML do contrato preenchido dentro desse container e chama `window.print()`.
3. CSS `@media print`: esconder o app inteiro, mostrar só `#contrato-print`; margens A4, fonte serif legível (pode usar a Cormorant/DM Sans já carregadas ou um serif padrão), quebras de página com `page-break-inside: avoid` nos blocos de assinatura.

## Dados que preenchem o contrato
- **CONSIGNANTE = fixo (Lizzie)** — deixe como constante no código, não vem do banco:
  - Nome: `Lizzie Comércio e Importação de Artigos Religiosos e Semijoias Ltda.`
  - CNPJ/MF: `37.690.436/0001-60`
  - Endereço: `Rua Tiradentes, n.º 446, Vila Itapura, sala 23, Campinas/SP – CEP 13.023-190`
  - Representante legal: `Lidiane Soares Figueiredo Coutinho`
  - E-mail: `lizziesemijoias@outlook.com`
  - Telefone: `(19) 99580-2087`
- **CONSIGNATÁRIO(A) = a revendedora** (da `profiles`): Nome, CPF/MF, RG, Endereço (montar linha única a partir de logradouro, número, complemento, bairro, cidade/estado, CEP), E-mail, Telefone.
- **FIADOR = opcional** (campos `fiador_*`): se preenchidos, mostra o quadro; se vazios, **omite** a linha do fiador na assinatura ou deixa em branco para preencher à mão. (No modelo, o fiador às vezes vem vazio — respeite isso.)

## O texto do contrato (íntegra — copie exatamente)
Reproduza o documento na íntegra. O quadro inicial (CONSIGNANTE / CONSIGNATÁRIA / FIADOR) vira uma **tabela** no topo; depois as cláusulas em texto corrido. Conteúdo exato:

**Título:** CONTRATO DE REVENDA EM CONSIGNAÇÃO

**Quadro (tabela de 2 colunas):** três blocos — CONSIGNANTE (fixo, dados acima), CONSIGNATÁRIO(A) (dados da revendedora), FIADOR (dados fiador_* ou vazio). Cada bloco com linhas: Nome, CPF/MF, RG, Endereço, E-mail, Telefone. (No bloco CONSIGNANTE troque "CPF/MF" por "CNPJ/MF" e inclua "Representante legal".)

**Corpo (parágrafos e cláusulas, na ordem):**
- Parágrafo de abertura: "Resolvem a CONSIGNANTE, o(a) CONSIGNATÁRIO(A)… celebraram o presente, que se regerá pelas cláusulas e condições a seguir elencadas:"
- **DAS CONSIDERAÇÕES INICIAIS** (3 parágrafos: art. 534–537 CC / Livre Iniciativa art. 170 CF; política de cooperação e boa-fé; autonomia das partes).
- **DOS OBJETIVOS DO CONTRATO** — Cláusulas 1ª a 6ª.
- **DOS PRAZOS E CONDIÇÕES DE DEVOLUÇÃO** — 7ª a 10ª (a 10ª cita a sede: Rua Tiradentes, 446, sala 23, Vila Itapura, Campinas/SP).
- **DOS PAGAMENTOS E COMISSÕES** — 11ª a 15ª (12ª: até R$ 1.799,99 → 30%; a partir de R$ 1.800,00 → 35%).
- **DAS OBRIGAÇÕES DA CONSIGNANTE** — 16ª a 18ª.
- **DAS OBRIGAÇÕES DO(A) CONSIGNATÁRIO(A)** — 19ª a 24ª.
- **DA APROPRIAÇÃO INDÉBITA** — 25ª e 26ª (art. 168 §1º III CP).
- **DAS GARANTIAS** — 27ª e 28ª (fiador; arts. 818, 827, 835, 838 CC).
- **DA RESCISÃO** — 29ª e 30ª (2 ciclos < R$ 1.000,00 → rescisão).
- **DO USO DA IMAGEM** — 31ª e 32ª.
- **DA CONFIDENCIALIDADE** — 33ª.
- **DAS DISPOSIÇÕES GERAIS** — 34ª a 40ª (37ª: multa R$ 9.000,00; 38ª: honorários 20%; 40ª: foro de Campinas/SP).
- Fecho: "Por estarem assim justos e contratados, firmam o presente instrumento em uma via para cada Parte…"
- Linha de local/data: `___________________________, ____ de __________ de ______ .` (pode pré-preencher a cidade da revendedora e a data de hoje, deixando em branco só o que falta — ou deixar tudo em branco para preencher à mão; **preferência: cidade + data de hoje preenchidas**).
- Assinaturas: CONSIGNANTE / CONSIGNATÁRIO(A) / FIADOR(A) / TESTEMUNHA 1 (CPF/MF) / TESTEMUNHA 2 (CPF/MF).

> O texto integral das cláusulas está no arquivo-fonte `NOVO Contrato de Revenda (1).docx` (que o Rondon enviou). **Copie as cláusulas na íntegra, palavra por palavra** — não resuma. Se tiver o arquivo, extraia dele; o resumo acima é só o índice para conferência.

## Botão
- No formulário/detalhe da revendedora: botão **"Gerar Contrato"** (ícone de documento/impressora de linha, sem emoji).
- **Habilitado só** quando os campos essenciais existirem: nome, cpf e endereço (logradouro+cidade). Se faltar, o botão fica desabilitado com dica "Complete CPF e endereço para gerar o contrato".
- Ao clicar: monta `#contrato-print` e chama `window.print()` (o usuário salva como PDF ou imprime). Como no `gerarPdfFechamento`, use um pequeno `setTimeout` antes do print se precisar renderizar.

## Padrões / cuidados
- Escapar todos os dados com `esc()` ao injetar no HTML.
- Formatar: CPF `000.000.000-00`, telefone `(00) 00000-0000`, data por extenso ou `dd/mm/aaaa`.
- Funções de `onclick` → `window`. Reaproveitar helpers. Sem emoji na UI.
- Não mexer em auth/RLS/PWA.

## Testes
1. Revendedora **completa** → "Gerar Contrato" habilitado → o quadro no topo mostra os dados dela certos; imprimir/salvar PDF sai com todas as cláusulas e as assinaturas.
2. Revendedora **sem CPF/endereço** → botão desabilitado com a dica.
3. **Com fiador** → o quadro do fiador aparece preenchido. **Sem fiador** → quadro do fiador vazio/omisso, sem quebrar o layout.
4. Conferir no PDF: sede na 10ª cláusula, comissões na 12ª, foro de Campinas na 40ª — os trechos fixos vieram inteiros.
5. `@media print` esconde o resto do app (só o contrato imprime). Console limpo; lint/build verdes.

## Commit sugerido
`feat(revendedoras): gerar contrato de consignação em PDF preenchido automaticamente`

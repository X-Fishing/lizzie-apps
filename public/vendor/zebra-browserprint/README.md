# Zebra Browser Print SDK

O app referencia este script em `index.html`:

```
/vendor/zebra-browserprint/BrowserPrint-3.x.min.js
```

## Como instalar

1. Baixe o SDK oficial em **zebra.com/browserprint** (é gratuito, mas é
   download direto do site da Zebra — este agente não pode baixar arquivos
   licenciados de terceiros).
2. Copie o arquivo `BrowserPrint-3.x.x.min.js` (a versão que vier) para esta
   pasta, **renomeando para `BrowserPrint-3.x.min.js`** (o nome que o
   `index.html` já referencia) — ou ajuste o `src` do `<script>` no
   `index.html` para o nome exato do arquivo baixado.
3. Também é preciso instalar o **serviço Zebra Browser Print** no Windows do
   computador que vai imprimir (mesmo site) — ele é quem conversa com a
   impressora (USB ou de rede já cadastrada nele). Isso é setup de máquina,
   não faz parte do código.

## Sem o SDK

Enquanto este arquivo não existir, o app funciona normalmente — a tela de
etiquetas detecta a ausência do Browser Print e mostra só o botão
**"Baixar .zpl"** (gera o arquivo com os comandos ZPL para enviar manualmente
pelo Zebra Setup Utility ou outra ferramenta).

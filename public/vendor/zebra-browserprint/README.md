# Zebra Browser Print SDK

Arquivo vendorizado aqui: **`BrowserPrint-3.1.250.min.js`** (referenciado
direto no `index.html`).

## De onde veio

Não é um download separado — **já vem junto do instalador** do serviço
Zebra Browser Print (o `.exe` que se instala no Windows, baixado em
zebra.com/browserprint → "Browser Print For Windows PC").

Depois de instalar o serviço, o SDK fica em:

```
C:\Program Files (x86)\Zebra Technologies\Zebra Browser Print\Documentation\BrowserPrint.js-<versão>\BrowserPrint-<versão>.min.js
```

Foi copiado de lá pra cá sem modificação.

## Se atualizar a versão do Browser Print

1. Reinstale/atualize o Browser Print normalmente.
2. Copie o novo `BrowserPrint-<versão>.min.js` da pasta `Documentation\...`
   pra esta pasta (`public/vendor/zebra-browserprint/`).
3. Atualize o `<script src="...">` no `index.html` pro novo nome de arquivo.

## Sem o SDK

Se este arquivo não existir (ex.: outro computador sem o Browser Print
instalado), o app funciona normalmente — a tela de etiquetas detecta a
ausência e mostra só o botão **"Baixar .zpl"** (gera o arquivo com os
comandos ZPL pra enviar manualmente).

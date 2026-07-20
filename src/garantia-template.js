// Layout do certificado de garantia (imagem gerada no navegador via Canvas).
// TUDO configurável aqui para o dono ajustar sem tocar na lógica de desenho.
// Quando existir a arte oficial: suba em lizzie-fotos/templates/garantia.png que
// ela vira o fundo (o desenho de texto continua por cima, nas posições abaixo).
export const GARANTIA_TEMPLATE = {
  width: 1080,
  height: 1350,                          // 4:5 — legível no WhatsApp
  bg: '#faf7f2',
  fundoStoragePath: 'templates/garantia.png',   // opcional (bucket lizzie-fotos)
  validadeAnos: 1,                       // decisão do dono: garantia de 1 ano

  cores: { marca: '#b08d57', titulo: '#5c4a54', texto: '#4a3b44', suave: '#8a7590', linha: '#e6ded4' },

  fontes: {
    marca:  "600 92px 'Cormorant Garamond', Georgia, serif",
    titulo: "400 46px 'Cormorant Garamond', Georgia, serif",
    rotulo: "600 22px 'DM Sans', sans-serif",
    texto:  "400 34px 'DM Sans', sans-serif",
    item:   "400 28px 'DM Sans', sans-serif",
    validade: "600 36px 'Cormorant Garamond', Georgia, serif",
    rodape: "400 22px 'DM Sans', sans-serif",
  },

  pos: {
    molduraMargem: 46,
    marcaY: 210, submarcaY: 250, tituloY: 340,
    margemX: 130,
    clienteRotuloY: 470, clienteY: 512,
    dataRotuloY: 600, dataY: 642,
    itensRotuloY: 740, itens0Y: 786, itensLineH: 46, itensMax: 12,
    validadeY: 1210, rodapeY: 1290,
  },
};

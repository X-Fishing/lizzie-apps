// Layout do certificado de garantia (imagem gerada no navegador via Canvas).
// A ARTE (fundo, src/assets/garantia-fundo.png) já traz moldura + "Lizzie /
// SEMIJOIAS / Certificado de Garantia". Aqui só o posicionamento dos DADOS
// dinâmicos, desenhados por cima na área limpa abaixo do título. Tudo
// configurável para ajustar sem tocar na lógica de desenho.
import fundoUrl from './assets/garantia-fundo.png';

export const GARANTIA_TEMPLATE = {
  width: 1080,
  height: 1350,                          // 4:5 — legível no WhatsApp
  bg: '#faf7f2',
  fundoUrl,                              // arte = só a moldura (sem texto gravado)
  validadeMeses: 12,                     // prazo da garantia (config única)
  // Área útil dentro da moldura (as folhinhas ficam nos cantos de baixo).
  areaX: 110, areaLargura: 860,

  cores: { marca: '#b08d57', titulo: '#5c4a54', texto: '#4a3b44', suave: '#8a7590', linha: '#e6ded4' },

  fontes: {
    numero: "600 24px 'DM Sans', sans-serif",
    rotulo: "600 20px 'DM Sans', sans-serif",
    texto:  "400 34px 'DM Sans', sans-serif",
    dataVal: "400 28px 'DM Sans', sans-serif",
    item:   "400 26px 'DM Sans', sans-serif",
    rodape: "400 20px 'DM Sans', sans-serif",
    // usados só no fallback sem arte (mantém o certificado funcionando)
    marca:  "600 92px 'Cormorant Garamond', Georgia, serif",
    titulo: "400 46px 'Cormorant Garamond', Georgia, serif",
  },

  // Layout de cima para baixo. A moldura útil vai de ~y75 a ~y1265; as
  // folhinhas ocupam os cantos inferiores (x<180 e x>900, y>1140).
  pos: {
    centroX: 540,
    marcaY: 210, submarcaY: 252, tituloY: 342,   // Lizzie / SEMIJOIAS / título
    numeroY: 424,                                 // CERTIFICADO Nº ...
    clienteRotuloY: 502, clienteY: 548,
    dataColL: 356, dataColR: 724,                 // datas em duas colunas
    dataRotuloY: 624, dataValY: 666,
    itensRotuloY: 742, itens0Y: 786, itensLineH: 40, itensMax: 8,
    rodapeY: 1200,                                // entre as folhinhas
    molduraMargem: 46,                            // fallback sem arte
  },
};

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
  fundoUrl,                              // arte versionada no repo (src/assets)
  arteComCabecalho: true,                // a arte já tem marca+título → não redesenhar
  validadeMeses: 12,                     // prazo da garantia (config única)

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

  // Posições para a ARTE atual (título "Certificado de Garantia" ~y=745).
  // Miolo limpo ~800..1150; rodapé/folhas ~1160..1245.
  pos: {
    centroX: 540,
    numeroY: 832,                        // "CERTIFICADO Nº ..." (dourado)
    clienteRotuloY: 900, clienteY: 944,
    dataColL: 356, dataColR: 724,        // datas em duas colunas
    dataRotuloY: 1006, dataValY: 1046,
    itensRotuloY: 1104, itens0Y: 1142, itensLineH: 38, itensMax: 2,
    // rodapé cobre o número solto que a arte trouxe ("2250")
    rodapeCoverY: 1200, rodapeCoverH: 46, rodapeY: 1224,
    // fallback (sem arte): moldura + cabeçalho programático
    molduraMargem: 46, marcaY: 210, submarcaY: 250, tituloY: 340, margemX: 130,
  },
};

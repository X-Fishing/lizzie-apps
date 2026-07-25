// Certificado de garantia — gera a imagem no navegador (Canvas), sobe no bucket
// público lizzie-fotos e devolve a URL + o link wa.me para enviar à cliente.
// Nada aqui pode derrubar a venda: quem chama trata o erro com toast/reenvio.
import { sb } from './supabase.js';
import { isoToBR, waMeLink } from './utils.js';
import { GARANTIA_TEMPLATE as T } from './garantia-template.js';

const primeiroNome = n => (n || '').trim().split(/\s+/)[0] || 'cliente';

// Número do certificado a partir do id da venda (curto e estável).
export function numeroCertificado(vendaId) {
  const s = String(vendaId || '').replace(/-/g, '').slice(-6).toUpperCase();
  return s || null;
}

// data ISO (yyyy-mm-dd) + N meses → dd/mm/aaaa (JS normaliza estouro de mês/dia).
function validadeBR(dataISO) {
  const base = dataISO && /^\d{4}-\d{2}-\d{2}/.test(dataISO) ? dataISO.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const [y, m, d] = base.split('-').map(Number);
  const alvo = new Date(y, m - 1 + T.validadeMeses, d);
  return `${String(alvo.getDate()).padStart(2, '0')}/${String(alvo.getMonth() + 1).padStart(2, '0')}/${alvo.getFullYear()}`;
}

// Fundo = arte versionada no repo (bundled, same-origin → não tainta o canvas).
function carregarFundo() {
  return new Promise(resolve => {
    if (!T.fundoUrl) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // sem arte → layout programático (fallback)
    img.src = T.fundoUrl;
  });
}

export async function gerarCertificadoGarantia({ cliente, dataISO, itens, revendedora, numero }) {
  // Garante as fontes carregadas (senão o Canvas usa fallback e desalinha).
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch { /* segue */ }

  const cv = document.createElement('canvas');
  cv.width = T.width; cv.height = T.height;
  const ctx = cv.getContext('2d');
  const P = T.pos;
  const cx = P.centroX;

  const fundo = await carregarFundo();
  if (fundo) {
    ctx.drawImage(fundo, 0, 0, T.width, T.height);
  } else {
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, T.width, T.height);
    ctx.strokeStyle = T.cores.linha; ctx.lineWidth = 2;
    ctx.strokeRect(P.molduraMargem, P.molduraMargem, T.width - 2 * P.molduraMargem, T.height - 2 * P.molduraMargem);
    ctx.strokeRect(P.molduraMargem + 12, P.molduraMargem + 12, T.width - 2 * (P.molduraMargem + 12), T.height - 2 * (P.molduraMargem + 12));
  }

  // Encurta o texto (com reticências) para caber na largura útil.
  const caber = (txt, maxW) => {
    if (ctx.measureText(txt).width <= maxW) return txt;
    let s = txt;
    while (s.length > 4 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  };

  // Cabeçalho — a arte é só a moldura, o texto é todo desenhado aqui.
  ctx.textAlign = 'center';
  ctx.fillStyle = T.cores.marca; ctx.font = T.fontes.marca;
  ctx.fillText('Lizzie', cx, P.marcaY);
  ctx.fillStyle = T.cores.titulo; ctx.font = T.fontes.rotulo;
  ctx.fillText('S E M I J O I A S', cx, P.submarcaY);
  ctx.fillStyle = T.cores.titulo; ctx.font = T.fontes.titulo;
  ctx.fillText('Certificado de Garantia', cx, P.tituloY);

  // Número do certificado (dourado)
  if (numero) {
    ctx.fillStyle = T.cores.marca; ctx.font = T.fontes.numero;
    ctx.fillText(`CERTIFICADO Nº ${String(numero).toUpperCase()}`, cx, P.numeroY);
  }

  // Cliente
  ctx.fillStyle = T.cores.suave; ctx.font = T.fontes.rotulo;
  ctx.fillText('CLIENTE', cx, P.clienteRotuloY);
  ctx.fillStyle = T.cores.texto; ctx.font = T.fontes.texto;
  ctx.fillText(caber(cliente || '—', T.areaLargura), cx, P.clienteY);

  // Datas em duas colunas: Compra | Válido até
  ctx.fillStyle = T.cores.suave; ctx.font = T.fontes.rotulo;
  ctx.fillText('COMPRA', P.dataColL, P.dataRotuloY);
  ctx.fillText('VÁLIDO ATÉ', P.dataColR, P.dataRotuloY);
  ctx.font = T.fontes.dataVal;
  ctx.fillStyle = T.cores.texto;
  ctx.fillText(isoToBR((dataISO || '').slice(0, 10)) || '—', P.dataColL, P.dataValY);
  ctx.fillStyle = T.cores.marca;
  ctx.fillText(validadeBR(dataISO), P.dataColR, P.dataValY);

  // Peças (com referência/SKU)
  ctx.fillStyle = T.cores.suave; ctx.font = T.fontes.rotulo;
  ctx.fillText('PEÇAS', cx, P.itensRotuloY);
  ctx.font = T.fontes.item;
  const lista = (itens || []).slice(0, P.itensMax);
  lista.forEach((it, i) => {
    const ref = it.referencia ? ` (${it.referencia})` : '';
    const qt = it.quantidade && it.quantidade > 1 ? `${it.quantidade}x ` : '';
    ctx.fillStyle = T.cores.texto;
    ctx.fillText(caber(`${qt}${it.descricao || 'Peça'}${ref}`, T.areaLargura), cx, P.itens0Y + i * P.itensLineH);
  });
  if ((itens || []).length > P.itensMax) {
    ctx.fillStyle = T.cores.suave;
    ctx.fillText(`+ ${itens.length - P.itensMax} outra(s) peça(s)`, cx, P.itens0Y + P.itensMax * P.itensLineH);
  }

  // Rodapé (entre as folhinhas dos cantos): revendedora + aviso curto.
  ctx.textAlign = 'center';
  ctx.fillStyle = T.cores.suave; ctx.font = T.fontes.rodape;
  const rev = revendedora ? `Revendedora ${revendedora} · ` : '';
  ctx.fillText(caber(`${rev}Garantia contra defeitos de fabricação (${T.validadeMeses} meses)`, 700), cx, P.rodapeY);

  return await new Promise((resolve, reject) =>
    cv.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob falhou'))), 'image/png'));
}

export async function uploadCertificado(vendaId, blob) {
  const path = `garantias-certificado/${vendaId}.png`;
  const { error } = await sb.storage.from('lizzie-fotos').upload(path, blob, { upsert: true, contentType: 'image/png' });
  if (error) throw error;
  const url = sb.storage.from('lizzie-fotos').getPublicUrl(path).data.publicUrl;
  return `${url}?v=${Date.now()}`;   // cache-bust p/ o reenvio
}

function msgGarantia(cliente, dataISO) {
  return `Oi ${primeiroNome(cliente)}! Aqui está o certificado de garantia das suas joias Lizzie Semijoias, válido até ${validadeBR(dataISO)}.`;
}

// Envia o certificado. No CELULAR compartilha a IMAGEM de verdade (share nativo →
// abre o WhatsApp com a foto anexada, de graça). Sem suporte (PC), sobe a imagem e
// manda o LINK no wa.me. Passe `blob`/`publicUrl` pré-gerados p/ o clique ficar
// síncrono (o share nativo exige gesto do usuário). Lança só em falha real.
export async function enviarCertificado({ vendaId, cliente, tel, dataISO, itens, revendedora, numero, blob, publicUrl }) {
  const mensagem = msgGarantia(cliente, dataISO);
  const b = blob || await gerarCertificadoGarantia({ cliente, dataISO, itens, revendedora, numero });
  const file = new File([b], `garantia-${vendaId || 'lizzie'}.png`, { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: mensagem }); return true; }
    catch (e) { if (e && e.name === 'AbortError') return true; /* senão cai no link */ }
  }
  // Fallback: link no wa.me (usa a URL pré-gerada p/ não travar em popup no PC).
  const url = publicUrl || await uploadCertificado(vendaId, b);
  const link = waMeLink(tel, `${mensagem}\n${url}`);
  if (link) { window.open(link, '_blank'); return true; }
  return false;
}

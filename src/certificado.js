// Certificado de garantia — gera a imagem no navegador (Canvas), sobe no bucket
// público lizzie-fotos e devolve a URL + o link wa.me para enviar à cliente.
// Nada aqui pode derrubar a venda: quem chama trata o erro com toast/reenvio.
import { sb } from './supabase.js';
import { isoToBR, waMeLink } from './utils.js';
import { GARANTIA_TEMPLATE as T } from './garantia-template.js';

const primeiroNome = n => (n || '').trim().split(/\s+/)[0] || 'cliente';

// data ISO (yyyy-mm-dd) + N anos → dd/mm/aaaa (normaliza 29/02).
function validadeBR(dataISO) {
  const base = dataISO && /^\d{4}-\d{2}-\d{2}/.test(dataISO) ? dataISO.slice(0, 10) : null;
  const [y, m, d] = (base || new Date().toISOString().slice(0, 10)).split('-').map(Number);
  const alvo = new Date(y + T.validadeAnos, m - 1, d);
  return `${String(alvo.getDate()).padStart(2, '0')}/${String(alvo.getMonth() + 1).padStart(2, '0')}/${alvo.getFullYear()}`;
}

function carregarFundo() {
  return new Promise(resolve => {
    try {
      const url = sb.storage.from('lizzie-fotos').getPublicUrl(T.fundoStoragePath).data.publicUrl;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);   // sem arte → layout programático
      img.src = url + '?v=1';
    } catch { resolve(null); }
  });
}

export async function gerarCertificadoGarantia({ cliente, dataISO, itens }) {
  // Garante as fontes carregadas (senão o Canvas usa fallback e desalinha).
  try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch { /* segue */ }

  const cv = document.createElement('canvas');
  cv.width = T.width; cv.height = T.height;
  const ctx = cv.getContext('2d');
  const P = T.pos;

  const fundo = await carregarFundo();
  if (fundo) {
    ctx.drawImage(fundo, 0, 0, T.width, T.height);
  } else {
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, T.width, T.height);
    ctx.strokeStyle = T.cores.linha; ctx.lineWidth = 2;
    ctx.strokeRect(P.molduraMargem, P.molduraMargem, T.width - 2 * P.molduraMargem, T.height - 2 * P.molduraMargem);
    ctx.strokeRect(P.molduraMargem + 12, P.molduraMargem + 12, T.width - 2 * (P.molduraMargem + 12), T.height - 2 * (P.molduraMargem + 12));
  }

  // Marca + título (centralizados)
  ctx.textAlign = 'center';
  ctx.fillStyle = T.cores.marca; ctx.font = T.fontes.marca;
  ctx.fillText('Lizzie', T.width / 2, P.marcaY);
  ctx.fillStyle = T.cores.suave; ctx.font = T.fontes.rotulo;
  ctx.fillText('S E M I J O I A S', T.width / 2, P.submarcaY);
  ctx.fillStyle = T.cores.titulo; ctx.font = T.fontes.titulo;
  ctx.fillText('Certificado de Garantia', T.width / 2, P.tituloY);

  // Campos (alinhados à esquerda)
  ctx.textAlign = 'left';
  const rotulo = (txt, y) => { ctx.fillStyle = T.cores.suave; ctx.font = T.fontes.rotulo; ctx.fillText(txt.toUpperCase(), P.margemX, y); };
  const valor  = (txt, y) => { ctx.fillStyle = T.cores.texto; ctx.font = T.fontes.texto; ctx.fillText(txt, P.margemX, y); };

  rotulo('Cliente', P.clienteRotuloY);           valor(cliente || '—', P.clienteY);
  rotulo('Data da compra', P.dataRotuloY);        valor(isoToBR((dataISO || '').slice(0, 10)) || '—', P.dataY);

  rotulo('Peças', P.itensRotuloY);
  ctx.fillStyle = T.cores.texto; ctx.font = T.fontes.item;
  const lista = (itens || []).slice(0, P.itensMax);
  lista.forEach((it, i) => {
    const ref = it.referencia ? ` (${it.referencia})` : '';
    const qt = it.quantidade && it.quantidade > 1 ? `${it.quantidade}x ` : '';
    ctx.fillText(`• ${qt}${it.descricao || 'Peça'}${ref}`, P.margemX, P.itens0Y + i * P.itensLineH);
  });
  if ((itens || []).length > P.itensMax) {
    ctx.fillStyle = T.cores.suave;
    ctx.fillText(`+ ${itens.length - P.itensMax} outra(s) peça(s)`, P.margemX, P.itens0Y + P.itensMax * P.itensLineH);
  }

  // Validade + rodapé
  ctx.textAlign = 'center';
  ctx.fillStyle = T.cores.marca; ctx.font = T.fontes.validade;
  ctx.fillText(`Garantia válida até ${validadeBR(dataISO)}`, T.width / 2, P.validadeY);
  ctx.fillStyle = T.cores.suave; ctx.font = T.fontes.rodape;
  ctx.fillText('Guarde este certificado. Garantia contra defeitos de fabricação.', T.width / 2, P.rodapeY);

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

// Gera + sobe + monta o wa.me. Lança em qualquer falha (o chamador trata).
export async function gerarEEnviarCertificado({ vendaId, cliente, tel, dataISO, itens }) {
  const blob = await gerarCertificadoGarantia({ cliente, dataISO, itens });
  const publicUrl = await uploadCertificado(vendaId, blob);
  const mensagem = `Oi ${primeiroNome(cliente)}! Aqui está o certificado de garantia das suas joias Lizzie Semijoias, válido até ${validadeBR(dataISO)}:`;
  return { publicUrl, waLink: waMeLink(tel, `${mensagem}\n${publicUrl}`) };
}

// Programa de Fidelidade (tela informativa — módulo em desenvolvimento).
// Estática por ora: níveis e benefícios. A pontuação real e a integração com
// o Controle de Vendas entram num ciclo futuro (ver PLANO-REDESIGN.md).
import { esc } from './utils.js';

const IC_CHECK = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const IC_INFO  = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

const NIVEIS = [
  { nome: 'Bronze', pontosMin: 0,    cor: '#b08d57', beneficios: ['5% de desconto em datas especiais', 'Acesso a coleções antecipadas'] },
  { nome: 'Prata',  pontosMin: 500,  cor: '#8a7590', beneficios: ['10% de desconto recorrente', 'Frete grátis acima de R$ 150'] },
  { nome: 'Ouro',   pontosMin: 1500, cor: '#d4a84b', beneficios: ['15% de desconto recorrente', 'Brinde exclusivo por trimestre'] },
];

export function loadFidelidade() {
  const cards = NIVEIS.map(n => `
    <div class="card" style="border:2px solid ${n.cor};padding:22px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="width:10px;height:10px;border-radius:50%;background:${n.cor};display:inline-block"></span>
        <div style="font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--plum)">${esc(n.nome)}</div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px">A partir de ${n.pontosMin} pontos</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${n.beneficios.map(b => `<div style="font-size:12.5px;color:var(--text);display:flex;gap:7px;align-items:center"><span style="color:${n.cor};display:inline-flex">${IC_CHECK}</span>${esc(b)}</div>`).join('')}
      </div>
    </div>`).join('');

  document.getElementById('panel-fidelidade').innerHTML = `
    <div class="page-head">
      <div>
        <h2>Programa de Fidelidade</h2>
        <div class="sub">Pontuação por compra e níveis de benefícios para clientes</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;margin-bottom:22px">${cards}</div>
    <div class="card" style="display:flex;gap:10px;align-items:flex-start">
      <span style="color:var(--gold);flex:none;margin-top:1px;display:inline-flex">${IC_INFO}</span>
      <div style="font-size:12.5px;color:var(--muted);line-height:1.6">1 ponto a cada R$ 1,00 em compras. Pontos expiram em 12 meses. <b>Módulo em desenvolvimento</b> — integração com o Controle de Vendas prevista para um próximo ciclo.</div>
    </div>`;
}

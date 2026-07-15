// Roteador por HASH (#/...), seguro para GitHub Pages (estático) — sem
// pushState nem 404.html: o hash não vai ao servidor, então F5 e link
// direto funcionam igual em produção e no localhost.
// A lógica de tela/guards vive em nav.js; aqui só o motor genérico.
const rotas = new Map();
let rotaAtual = null;

export function registrar(padrao, render) { rotas.set(padrao, render); }

// Não é rota: hash de auth (OAuth/recuperação) ou querystring no hash.
function ehHashDeAuth(bruto) {
  return /access_token|refresh_token|(?:[#&?])error=|type=recovery/.test(bruto || '');
}

function parseHash() {
  const h = (location.hash || '#/').replace(/^#/, '');
  return h.startsWith('/') ? h : '/' + h;
}

// Casa '/revendedoras/123' com o padrão '/revendedoras/:id'.
function casar(caminho) {
  for (const [padrao, render] of rotas) {
    const p = padrao.split('/');
    const c = caminho.split('/');
    if (p.length !== c.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(c[i]);
      else if (p[i] !== c[i]) { ok = false; break; }
    }
    if (ok) return { render, params };
  }
  return null;
}

// replace:true → não cria entrada no histórico (redirecionamentos automáticos).
export function navegar(caminho, { replace = false } = {}) {
  const alvo = '#' + caminho;
  if (location.hash === alvo) { resolver(true); return; } // re-clique: reaplica
  if (replace) location.replace(location.pathname + location.search + alvo);
  else location.hash = alvo;   // dispara hashchange → resolver()
}

export function rotaCorrente() { return parseHash(); }

function resolver(forcar = false) {
  if (ehHashDeAuth(location.hash)) return;   // deixa o supabase-js tratar
  const caminho = parseHash();
  if (!forcar && caminho === rotaAtual) return;   // evita re-render duplo
  rotaAtual = caminho;
  const m = casar(caminho);
  if (!m) { navegar('/', { replace: true }); return; }  // rota desconhecida → raiz
  m.render(m.params);
}

let ligado = false;
export function iniciar() {
  if (!ligado) { window.addEventListener('hashchange', () => resolver()); ligado = true; }
  // Pós-login por OAuth pode deixar resquício de token no hash: limpa para a
  // raiz (o replace dispara hashchange → resolver cai no painel inicial).
  if (ehHashDeAuth(location.hash)) {
    location.replace(location.pathname + location.search + '#/');
    return;
  }
  resolver(true);   // resolve a rota atual (F5 / link direto / pós-login)
}

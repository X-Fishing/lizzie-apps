// Foto de perfil da revendedora: selfie (câmera) ou upload de arquivo.
// Bucket PRIVADO fotos-revendedoras (path {uid}/perfil.jpg); em profiles.foto_url
// gravamos o PATH e exibimos via URL assinada (bucket não é público).
import { sb } from './supabase.js';
import { state } from './state.js';
import { toast, sbQ, esc } from './utils.js';

const BUCKET = 'fotos-revendedoras';
let streamCamera = null;   // MediaStream ativo (para desligar ao fechar)
let blobPendente = null;   // imagem já redimensionada aguardando "Salvar"

// URL assinada da foto do perfil logado (cache da sessão).
export async function urlFotoPerfil(force = false) {
  const path = state.currentProfile?.foto_url;
  if (!path) return null;
  if (!force && state.fotoPerfilSignedUrl) return state.fotoPerfilSignedUrl;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return null;
  state.fotoPerfilSignedUrl = data.signedUrl;
  return data.signedUrl;
}

// Avatar redondo com borda rose; cai nas iniciais quando não há foto.
export function avatarHtml(nome, url, size = 52) {
  const iniciais = (nome || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  const base = `width:${size}px;height:${size}px;border-radius:50%;border:2px solid var(--rose);flex:none;`;
  if (url) {
    return `<img src="${esc(url)}" alt="Foto de perfil" style="${base}object-fit:cover;display:block">`;
  }
  return `<div style="${base}background:var(--blush);color:var(--rose);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:${Math.round(size * 0.38)}px">${esc(iniciais)}</div>`;
}

// ── Modal ────────────────────────────────────────────────────────────
export function perfilAbrirFoto() {
  blobPendente = null;
  pararCamera();
  document.getElementById('fp-preview').style.display = 'none';
  document.getElementById('fp-video-wrap').style.display = 'none';
  document.getElementById('fp-salvar').disabled = true;
  document.getElementById('fp-msg').textContent = '';
  document.getElementById('fp-arquivo').value = '';
  const { openModal } = window; openModal('modal-foto-perfil');
}

export function perfilFecharFoto() {
  pararCamera();
  const { closeModal } = window; closeModal('modal-foto-perfil');
}

function pararCamera() {
  if (streamCamera) { streamCamera.getTracks().forEach(t => t.stop()); streamCamera = null; }
  const v = document.getElementById('fp-video');
  if (v) v.srcObject = null;
}

// ── Selfie via câmera ────────────────────────────────────────────────
export async function perfilTirarSelfie() {
  const msg = document.getElementById('fp-msg');
  msg.textContent = '';
  try {
    streamCamera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    const v = document.getElementById('fp-video');
    v.srcObject = streamCamera;
    document.getElementById('fp-video-wrap').style.display = 'block';
    document.getElementById('fp-preview').style.display = 'none';
  } catch (e) {
    console.warn('Câmera indisponível:', e);
    msg.textContent = 'Não conseguimos acessar a câmera (permissão negada?). Você pode enviar uma foto da galeria pelo botão "Enviar arquivo".';
  }
}

export function perfilCapturar() {
  const v = document.getElementById('fp-video');
  if (!v || !v.videoWidth) { toast('Câmera ainda carregando…'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = v.videoWidth; canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);
  pararCamera();
  document.getElementById('fp-video-wrap').style.display = 'none';
  canvas.toBlob(b => redimensionarEPrever(b), 'image/jpeg', 0.92);
}

// ── Upload de arquivo ────────────────────────────────────────────────
export function perfilArquivo(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  pararCamera();
  document.getElementById('fp-video-wrap').style.display = 'none';
  redimensionarEPrever(file);
}

// Redimensiona para máx. 800px e comprime em JPEG (~0.8) via canvas —
// economiza storage e banda antes do upload.
function redimensionarEPrever(blobOuFile) {
  const img = new Image();
  const url = URL.createObjectURL(blobOuFile);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const MAX = 800;
    const escala = Math.min(1, MAX / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(b => {
      if (!b) { toast('Não deu pra processar a imagem'); return; }
      blobPendente = b;
      const prev = document.getElementById('fp-preview');
      prev.src = URL.createObjectURL(b);
      prev.style.display = 'block';
      document.getElementById('fp-salvar').disabled = false;
    }, 'image/jpeg', 0.8);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Arquivo não é uma imagem válida'); };
  img.src = url;
}

// ── Salvar (upload + grava o path em profiles.foto_url) ─────────────
export async function perfilSalvarFoto(btn) {
  if (!blobPendente) { toast('Tire a selfie ou escolha um arquivo primeiro'); return; }
  btn.disabled = true; btn.textContent = 'Salvando…';
  const path = `${state.currentUser.id}/perfil.jpg`;
  const { error: upErr } = await sb.storage.from(BUCKET)
    .upload(path, blobPendente, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) {
    console.error('Upload foto perfil:', upErr);
    toast(/bucket/i.test(upErr.message || '') ? 'Bucket não encontrado — rode db-functions.sql no Supabase.' : 'Erro ao enviar a foto');
    btn.disabled = false; btn.textContent = 'Salvar foto';
    return;
  }
  const { error } = await sbQ(sb.from('profiles').update({ foto_url: path }).eq('id', state.currentUser.id));
  btn.disabled = false; btn.textContent = 'Salvar foto';
  if (error) { toast('Erro ao salvar o perfil'); return; }
  state.currentProfile.foto_url = path;
  state.fotoPerfilSignedUrl = null;   // força nova URL assinada
  toast('Foto de perfil atualizada!');
  perfilFecharFoto();
  const { loadDashboard } = window; loadDashboard();
}

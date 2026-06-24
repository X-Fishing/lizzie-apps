import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;

// Le os dados do link de recuperacao na URL ANTES de criar o cliente
// (o supabase-js consome e limpa o hash ao inicializar). Por isso esta leitura
// fica AQUI, no mesmo modulo e antes do createClient — em ES modules o corpo
// deste arquivo roda no momento do import, antes do corpo do main.js.
const _hashParams  = new URLSearchParams((location.hash || '').replace(/^#/, ''));
const _queryParams = new URLSearchParams(location.search || '');
export const RECOVERY_IN_URL = _hashParams.get('type') === 'recovery' || _queryParams.get('type') === 'recovery';
export const URL_AUTH_ERROR  = _hashParams.get('error_description') || _queryParams.get('error_description') || null;

// flowType 'implicit': o link de recuperacao volta com #...&type=recovery no
// hash (deterministico e detectavel), em vez do formato PKCE (?code=...).
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
});

// Edge Function: criar-acesso-revendedora
// Cria (ou redefine) o ACESSO de uma revendedora e devolve uma senha
// provisória para a funcionária passar no WhatsApp.
//
// POR QUE EXISTE: o pré-cadastro no admin cria só a linha em profiles — não
// cria conta em auth.users. A revendedora então via "e-mail ou senha
// incorretos" e o "esqueci minha senha" não mandava nada (o Supabase ignora
// e-mail sem conta). Aqui a conta é criada já CONFIRMADA, sem depender de
// e-mail, link que expira ou de a cliente acertar o fluxo no celular.
//
// Segurança: exige JWT (verify_jwt = true no config.toml) E confirma no banco
// que quem chamou é admin/gestor. A service role nunca sai daqui.
// Interface: POST { profile_id } → { ok, email, senha, criado }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// Senha provisória fácil de ditar/digitar (sem 0/O/1/l/I para não confundir).
function novaSenha(): string {
  const letras = 'abcdefghijkmnpqrstuvwxyz'
  const nums = '23456789'
  const r = (s: string) => s[Math.floor(Math.random() * s.length)]
  return 'liz' + Array.from({ length: 3 }, () => r(letras)).join('') + Array.from({ length: 3 }, () => r(nums)).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'use POST' }, 405)
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: 'função sem configuração de ambiente' }, 500)

  // 1) Quem está chamando? (JWT do app)
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'sem credencial' }, 401)
  const sbUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } })
  const { data: { user } } = await sbUser.auth.getUser()
  if (!user) return json({ error: 'sessão inválida' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // 2) É admin/gestor? (confere no banco — não confia no cliente)
  const { data: quem } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (!quem || !['admin', 'func_completo'].includes(quem.role)) {
    return json({ error: 'sem permissão para criar acesso' }, 403)
  }

  // 3) Revendedora alvo
  let body: { profile_id?: string }
  try { body = await req.json() } catch { return json({ error: 'JSON inválido' }, 400) }
  if (!body.profile_id) return json({ error: 'informe profile_id' }, 400)

  const { data: rev } = await admin.from('profiles')
    .select('id,nome,email').eq('id', body.profile_id).maybeSingle()
  if (!rev) return json({ error: 'revendedora não encontrada' }, 404)
  let email = (rev.email ?? '').trim().toLowerCase()

  const senha = novaSenha()

  // 4) A CONTA DELA É PELO ID, não pelo e-mail: profiles.id = auth.users.id.
  //    Procurar só por e-mail era o bug — ao trocar o e-mail no cadastro, a
  //    busca não achava a conta existente, o código caía no "criar" e o
  //    trigger handle_new_user tentava inserir um profile com um e-mail que
  //    já existe. O índice único por lower(email) estourava e a mensagem que
  //    chegava era um "Database error creating new user" genérico. Resultado
  //    prático: depois de corrigir o e-mail dela, ninguém mais conseguia
  //    gerar o acesso — e ainda sobrava uma conta órfã em auth.users.
  const { data: contaPorId } = await admin.auth.admin.getUserById(body.profile_id)
  const conta = contaPorId?.user ?? null

  if (conta) {
    const emailAtual = (conta.email ?? '').toLowerCase()
    // Cadastro sem e-mail mas com conta: o login manda. Sem isto, a
    // revendedora ficava sem como redefinir a senha (o botão nem aparecia).
    if (!email) email = emailAtual

    const trocou = !!email && email !== emailAtual
    if (trocou) {
      // O e-mail do CADASTRO é a fonte da verdade: a pessoa acabou de editá-lo
      // de propósito. Levar o login junto é o que faz "mudar o e-mail dela"
      // significar alguma coisa.
      const { data: donoDoNovo } = await admin.rpc('fn_auth_uid_por_email', { p_email: email })
      if (donoDoNovo && donoDoNovo !== conta.id) {
        return json({ error: `o e-mail ${email} já é o login de outra conta — confira o endereço ou use o cadastro existente` }, 409)
      }
    }

    const patch: Record<string, unknown> = { password: senha, email_confirm: true }
    if (trocou) patch.email = email
    const { error } = await admin.auth.admin.updateUserById(conta.id, patch)
    if (error) {
      return json({ error: (trocou ? 'não foi possível atualizar o e-mail de acesso: ' : 'não foi possível redefinir a senha: ') + error.message }, 502)
    }
    return json({ ok: true, email, senha, criado: false, email_anterior: trocou ? emailAtual : null })
  }

  // 5) Sem conta com o id dela. Daqui para baixo o e-mail é obrigatório.
  if (!email) return json({ error: 'revendedora sem e-mail — preencha o e-mail no cadastro antes' }, 400)

  // Conta avulsa com esse e-mail (id diferente do profile — cadastro que ela
  // mesma criou antes do pré-cadastro): redefine a senha nela.
  const { data: uidPorEmail } = await admin.rpc('fn_auth_uid_por_email', { p_email: email })
  if (uidPorEmail) {
    const { error } = await admin.auth.admin.updateUserById(uidPorEmail, {
      password: senha, email_confirm: true,
    })
    if (error) return json({ error: 'não foi possível redefinir a senha: ' + error.message }, 502)
    return json({ ok: true, email, senha, criado: false, email_anterior: null })
  }

  // 6) Cria já confirmada (sem e-mail de confirmação, sem link que expira).
  //    O trigger handle_new_user adota o pré-cadastro pelo e-mail e leva
  //    junto consignados/garantias/vendas/maletas.
  const { error } = await admin.auth.admin.createUser({
    email, password: senha, email_confirm: true,
    user_metadata: { nome: rev.nome },
  })
  if (error) return json({ error: 'não foi possível criar o acesso: ' + error.message }, 502)
  return json({ ok: true, email, senha, criado: true, email_anterior: null })
})

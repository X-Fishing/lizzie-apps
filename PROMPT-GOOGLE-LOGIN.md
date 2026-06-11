# Prompt: Login com Google

## Antes de colar no VS Code — configuração manual (Rondon faz)

1. **Google Cloud Console** (console.cloud.google.com) → criar projeto (ou usar existente) → APIs & Services → Credentials → Create Credentials → **OAuth client ID** → tipo "Web application":
   - Authorized JavaScript origins: `https://app-lizzie.netlify.app` e `http://127.0.0.1:3000`
   - Authorized redirect URIs: `https://qoouzjntyfzcxnwjksiu.supabase.co/auth/v1/callback`
   - Antes disso, configurar a "OAuth consent screen" (tipo External, nome "Lizzie Semijoias", e-mail de suporte). Publicar o app (Publishing status: In production) para não expirar em 7 dias.
   - Guardar **Client ID** e **Client Secret**.
2. **Supabase** → Authentication → Sign In / Providers → **Google** → Enable → colar Client ID e Secret → Save.
3. **Supabase** → Authentication → URL Configuration → conferir que `https://app-lizzie.netlify.app` está em Site URL ou Redirect URLs (e adicionar `http://127.0.0.1:3000` para testes locais).

Feito isso, cole o prompt abaixo no chat do VS Code.

---

Adicione login com Google ao app Lizzie Semijoias (`index.html`). O provider Google já está habilitado no Supabase. Atenção às particularidades do código existente antes de mexer:

- O cliente Supabase é criado com `flowType: 'implicit'` e há código que lê o hash da URL ANTES de criar o cliente (fluxo de recuperação de senha). O retorno do OAuth também vem no hash (`#access_token=...`) — garanta que o código de recovery só intercepta hash com `type=recovery` e deixa o hash do OAuth ser processado normalmente pelo supabase-js.
- Existe um trigger no banco que cria o `profile` no signup a partir de `raw_user_meta_data` (ver db-functions.sql ou o SQL aplicado no item "cadastro: trigger cria profile"). Usuárias do Google não passam pelo formulário de cadastro.
- Fluxo de aprovação deve permanecer: profile novo nasce com `role='revendedora'`, `aprovada=false` → tela "Aguardando aprovação".

## 1. Botão "Entrar com Google"

Na aba de login (e também na de cadastro), adicionar abaixo do botão existente um separador "ou" e um botão no padrão visual do Google (fundo branco, logo G, texto "Continuar com o Google"), chamando:

```js
async function loginGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname }
  });
  if (error) toast('Erro ao conectar com o Google');
}
```

Não inventar CSS novo destoante — usar as variáveis de cor existentes para o container.

## 2. Trigger do banco: cobrir usuárias vindas do Google

Atualizar a function do trigger (gerar arquivo .sql idempotente e me instruir a rodar no SQL Editor) para extrair o nome do metadata do Google:

```sql
nome := coalesce(
  new.raw_user_meta_data->>'nome',        -- cadastro por formulário
  new.raw_user_meta_data->>'full_name',   -- Google
  new.raw_user_meta_data->>'name',
  split_part(new.email, '@', 1)
);
```

Telefone e cidade ficam null (Google não fornece). Manter `aprovada=false`. O trigger deve ser idempotente também quanto a conflito (`on conflict (id) do nothing`) para login repetido não quebrar.

## 3. Complemento de cadastro pós-login

No `loadUser()`: se o profile existe, está aprovado, mas `telefone` é null/vazio, abrir um modal único (não fechável por clique fora) pedindo **telefone** (obrigatório, com máscara) e **cidade** (opcional), com um botão salvar que faz update no próprio profile e segue para o dashboard. O telefone é usado para o WhatsApp das trocas de maleta, então é importante. Não mostrar esse modal para a admin.

## 4. Conta existente com mesmo e-mail

Se uma revendedora que já tem conta por e-mail/senha entrar com Google usando o mesmo e-mail, o Supabase vincula as identidades automaticamente quando o e-mail é verificado. Apenas confirme que nada no código assume um único método de login. Não implementar unlink.

## 5. Verificação

1. Login Google com conta nova → cai em "Aguardando aprovação"; admin aprova → próxima entrada cai no modal de telefone → preenche → dashboard.
2. Login Google com conta já aprovada e telefone preenchido → direto ao dashboard, sem modal.
3. Reset de senha continua funcionando (link de recovery não foi afetado).
4. Login por e-mail/senha continua funcionando.
5. Testar no PWA instalado no celular (Android e iPhone) — o redirect deve voltar para o app.
6. Commits separados: botão+fluxo / trigger SQL / modal complemento. Mensagens em português no padrão do repo.

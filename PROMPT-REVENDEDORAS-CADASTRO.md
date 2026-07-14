# PROMPT 1 — Cadastro completo de Revendedoras (grid + formulário + migração)

> Rodar no VS Code, pasta **`D:\lizzie-apps`** (só nela). Branch: `feat/revendedoras-cadastro`.
> Arquivos: nova migração SQL + **`src/admin.js`** (tela de Revendedoras) + `index.html`/`main.js` (form + window).
> `npm run lint` + `npm run build` verdes antes do commit. Rodar a migração no Supabase (SQL Editor) antes de testar.

## Contexto
A tela de Revendedoras (`src/admin.js`, painel `admin`) hoje é uma lista focada em vínculo Bling/trocas. Precisa virar um **cadastro completo**: grid com os dados principais + formulário para **criar** e **editar** (inclusive completar os dados de quem já está no sistema). Os dados alimentam o "Gerar Contrato" (Prompt 2).

A tabela `profiles` hoje tem: `nome, telefone, cidade, estado, numero, complemento, email, created_at, foto_url` (+ controle: role, aprovada, teste, bling_contato_id…). **Faltam** os campos do contrato.

## Parte 0 — Migração `supabase/migrations/0016_revendedora_cadastro.sql`
```sql
-- Cadastro completo da revendedora (dados do contrato de consignação).
-- CPF/RG/nascimento e endereço estruturado.
alter table profiles
  add column if not exists cpf            text,
  add column if not exists rg             text,
  add column if not exists data_nascimento date,
  add column if not exists cep            text,
  add column if not exists logradouro     text,
  add column if not exists bairro         text,
  -- Fiador (opcional — o contrato tem quadro de fiador)
  add column if not exists fiador_nome      text,
  add column if not exists fiador_cpf       text,
  add column if not exists fiador_rg        text,
  add column if not exists fiador_endereco  text,
  add column if not exists fiador_email     text,
  add column if not exists fiador_telefone  text;
-- (numero, complemento, cidade, estado, telefone, email já existem)
```

### ⚠️ LGPD — RLS (CPF/RG são dados sensíveis)
A `profiles` já teve furo de RLS corrigido antes. **Garanta na migração / confira as policies** que:
- Só **gestor/admin** (staff) lê os campos `cpf, rg, data_nascimento, cep, logradouro, bairro, fiador_*` de outras pessoas.
- A **própria revendedora** só enxerga o próprio registro (já é o padrão do app).
- Nenhuma leitura anônima. Se as policies atuais já restringem `profiles` por papel, os novos campos herdam — mas **verifique explicitamente** com o mesmo teste anônimo usado no `RLS-policies.sql` (deve retornar 0 linhas sem login).

## Parte 1 — Grid nova (substitui a atual em `renderRevCard`/lista)
Mantenha o card bonito atual, mas oriente ao **cadastro**, não só ao Bling. Cada card mostra:
- Avatar (inicial), **Nome**, **Telefone**, **Cidade/Estado**, badge **Ativa/Pendente**.
- Uma linha discreta de status que já existe (próxima troca / em aberto) pode ficar.
- **Indicador de cadastro incompleto**: se faltar CPF, RG, nascimento ou endereço, mostrar um selo discreto tipo "Cadastro incompleto" (ajuda a completar as antigas).
- Clique no card → abre o **formulário de edição** (hoje abre `verRevendedora`; redirecione para o form).
- Botão **"+ Nova revendedora"** no topo → formulário em branco.

Mantenha os controles de gestão que já existem (aprovar/revogar, marcar teste, vínculo Bling, excluir) — podem virar ações dentro do form/detalhe.

## Parte 2 — Formulário criar/editar (`div#panel-admin` ou um sub-form)
Campos, na ordem do contrato:
- **Dados pessoais:** Nome*, CPF, RG, Data de nascimento, Telefone celular*, E-mail.
- **Endereço:** CEP → **busca automática ViaCEP** (ver Parte 3) → Logradouro, Número, Complemento, Bairro, Cidade, Estado.
- **Data do cadastro:** editável (campo `created_at`; default = hoje ao criar; nas antigas, permitir corrigir). Trate como `date`/`timestamp` — não sobrescreva sem o usuário mexer.
- **Fiador (opcional, seção colapsável):** Nome, CPF, RG, Endereço (linha única), E-mail, Telefone.

Regras:
- Só **Nome** é obrigatório para salvar (os demais podem faltar — é a realidade das antigas). Mas o **botão Gerar Contrato** (Prompt 2) só habilita com os campos essenciais preenchidos (nome, cpf, endereço) — deixe um gancho para isso.
- **Máscaras** (reutilize/estenda o `maskMoneyBR`/utils): CPF `000.000.000-00`, RG livre, CEP `00000-000`, telefone `(00) 00000-0000`, data `dd/mm/aaaa`.
- **Validação leve:** CPF com dígito verificador (avisa mas não bloqueia salvar — só alerta "CPF parece inválido"). E-mail formato básico.
- Salvar = `update` (ou `insert` no caso de nova) na `profiles`, só campos preenchidos.
- Ações de gestor (aprovar/excluir/etc.) só para quem já tem hoje (não afrouxar permissão).

## Parte 3 — Busca de CEP (ViaCEP, grátis, sem chave)
```js
async function buscarCep(cep) {
  const limpo = (cep || '').replace(/\D/g, '');
  if (limpo.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${limpo}/json/`);
    const d = await r.json();
    if (d.erro) return null;
    return { logradouro: d.logradouro, bairro: d.bairro, cidade: d.localidade, estado: d.uf };
  } catch { return null; }
}
```
- Ao sair do campo CEP (ou digitar 8 dígitos), preencher logradouro/bairro/cidade/estado (sem sobrescrever o que o usuário já digitou à mão, se preferir). Falha silenciosa → deixa preencher manual.

## Padrões do projeto
- Funções de `onclick` → `window` (`Object.assign` no `main.js`).
- Reaproveitar `toast`, `esc`, `sbQ`, `confirmarAcao`, ícones de linha. **Sem emoji.**
- Não mexer em auth, PWA. Não mudar chaves de permissão de menu.

## Testes
1. **Migração:** rode o SQL; confira que as colunas existem e o teste anônimo de RLS retorna 0 linhas.
2. **Nova revendedora:** cadastre uma completa (com CEP automático) → salva → aparece na grid.
3. **Editar antiga:** abra uma existente (ex.: Bruna Ventura), complete CPF/RG/endereço → salva → o selo "incompleto" some.
4. **Fiador:** preencha o fiador opcional e confirme que grava.
5. **Permissão:** revendedora comum **não** vê CPF/RG de ninguém; gestor vê. Anônimo não lê nada.
6. Console limpo; lint e build verdes.

## Commits sugeridos
1. `feat(revendedoras): migração de cadastro completo (cpf/rg/nascimento/endereço/fiador) + RLS`
2. `feat(revendedoras): grid e formulário criar/editar com busca de CEP`
```
```

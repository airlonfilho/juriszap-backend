# Autenticação com Supabase - JurisZap

## 📋 Configuração

### 1. Variáveis de Ambiente

Adicione no arquivo `.env`:

```env
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua_chave_publica_supabase
```

### 2. Obter as Credenciais

1. Acesse [Supabase Dashboard](https://app.supabase.com)
2. Selecione seu projeto
3. Vá em **Settings** → **API**
4. Copie:
   - **URL**: Para `SUPABASE_URL`
   - **anon/public key**: Para `SUPABASE_ANON_KEY`

## 🔒 Como Funciona

### Middleware `requireAuth`

Protege rotas que exigem autenticação. O middleware:

1. Verifica o header `Authorization: Bearer <token>`
2. Valida o token com Supabase Auth
3. Anexa os dados do usuário em `req.user`
4. Retorna 401 se o token for inválido

### Estrutura do `req.user`

```typescript
{
  id: string;        // UUID do usuário no Supabase
  email: string;     // Email do usuário
  role: string;      // Role do usuário (padrão: 'advogado')
}
```

## 🧪 Como Testar

### 1. Criar um Usuário no Supabase

```bash
# No Supabase Dashboard ou via API
# SQL para criar usuário de teste:
```

```sql
-- No Supabase SQL Editor
INSERT INTO auth.users (email, encrypted_password, email_confirmed_at)
VALUES ('teste@juriszap.com', crypt('senha123', gen_salt('bf')), now());
```

### 2. Fazer Login e Obter Token

```bash
curl -X POST 'https://seu-projeto.supabase.co/auth/v1/token?grant_type=password' \
  -H 'apikey: SUA_SUPABASE_ANON_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "teste@juriszap.com",
    "password": "senha123"
  }'
```

Resposta:
```json
{
  "access_token": "eyJhbGc...", 
  "refresh_token": "...",
  "user": { "id": "...", "email": "..." }
}
```

### 3. Usar o Token nas Requisições

```bash
# Exemplo: Salvar um processo
curl -X POST http://localhost:3000/api/meus-processos/salvar \
  -H 'Authorization: Bearer eyJhbGc...' \
  -H 'Content-Type: application/json' \
  -d '{
    "numeroCNJ": "0012345-67.2024.8.26.0100",
    "classe": "Procedimento Comum Cível",
    "tomDeVoz": "empático"
  }'
```

## 📋 Rotas Protegidas

Todas as rotas abaixo requerem o header `Authorization: Bearer <token>`:

- `POST /api/meus-processos/salvar`
- `GET /api/dashboard`
- `GET /api/meus-processos`
- `PUT /api/mensagens/:id/aprovar`
- `GET /api/whatsapp/status`
- `POST /api/whatsapp/conectar`
- `POST /api/whatsapp/desconectar`

### POST /api/meus-processos/salvar

Salva um novo processo para o advogado autenticado. Realiza todo o fluxo:
1. **Verifica limite do plano**: Garante que o advogado não excedeu seu limite de processos
2. **Verifica/cria o cliente**: Busca por telefone ou cria novo
3. **Salva o processo**: Armazena no banco de dados
4. **Consulta Datajud**: Busca dados atualizados do processo
5. **Traduz a última movimentação**: Usa Gemini AI para criar mensagem WhatsApp
6. **Salva a primeira mensagem**: Status `AGUARDANDO` para aprovação do advogado

> **⚠️ Limites por Plano:**
> - **FREE**: 10 processos
> - **PRO**: 50 processos  
> - **ENTERPRISE**: 100 processos
> 
> Se o limite for atingido, retorna **403 Forbidden**. Veja [PLANOS-E-LIMITES.md](PLANOS-E-LIMITES.md) para mais detalhes.

**Request:**
```json
{
  "numeroCNJ": "0012345-67.2024.8.26.0100",
  "nomeCliente": "João Silva",
  "telefoneCliente": "85999999999",
  "tomDeVoz": "empático e tranquilizador"
}
```

**Campos:**
- `numeroCNJ` (obrigatório): Número CNJ do processo
- `nomeCliente` (obrigatório): Nome completo do cliente
- `telefoneCliente` (obrigatório): Telefone do cliente (será usado para verificar duplicação)
- `tomDeVoz` (opcional): Tom da tradução (padrão: "empático e tranquilizador")

**Response (201):**
```json
{
  "success": true,
  "data": {
    "processo": {
      "id": "uuid",
      "numeroCNJ": "0012345-67.2024.8.26.0100",
      "classe": "Procedimento Comum Cível",
      "tomDeVoz": "empático e tranquilizador",
      "advogadoId": "uuid",
      "clienteId": "uuid",
      "totalMovimentacoes": 15,
      "dataUltimaAtualizacao": "2024-03-09T10:00:00.000Z",
      "createdAt": "2026-03-10T12:00:00.000Z"
    },
    "cliente": {
      "id": "uuid",
      "nome": "João Silva",
      "telefone": "85999999999"
    },
    "primeiraMensagem": {
      "id": "uuid",
      "dataMovimentacao": "2024-03-09T10:00:00.000Z",
      "textoTecnico": "Conclusão - para decisão",
      "textoTraduzido": "Olá João! Temos uma atualização sobre seu processo. O juiz recebeu os documentos e está analisando para tomar uma decisão...",
      "status": "AGUARDANDO",
      "processoId": "uuid",
      "traducao": {
        "is_relevant_for_client": true,
        "requires_lawyer_action": false,
        "lawyer_summary": "Movimentação de conclusão traduzida com tom empático"
      }
    }
  }
}
```

**Fluxo Interno:**

1. **Verificação do Cliente**: Se já existe um cliente com o telefone informado para este advogado, reutiliza. Caso contrário, cria um novo.

2. **Consulta ao Datajud**: Busca os dados reais do processo no CNJ para obter classe e movimentações.

3. **Tradução Automática**: A última movimentação é automaticamente traduzida usando Google Gemini AI.

4. **Primeira Mensagem**: Salva a tradução como primeira mensagem com status `AGUARDANDO` para aprovação do advogado.

**Exemplo de uso:**
```bash
curl -X POST http://localhost:3000/api/meus-processos/salvar \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "numeroCNJ": "0012345-67.2024.8.26.0100",
    "nomeCliente": "Maria Santos",
    "telefoneCliente": "11987654321",
    "tomDeVoz": "profissional e claro"
  }'
```

**Response (409) - Processo já existe:**
```json
{
  "success": false,
  "error": "Processo já cadastrado",
  "message": "Este processo já está cadastrado no sistema"
}
```

**Response (403) - Limite de processos atingido:**
```json
{
  "success": false,
  "error": "Limite atingido",
  "message": "Você atingiu o limite de 10 processos do plano FREE. Faça um upgrade para continuar adicionando.",
  "limitReached": true,
  "plano": "FREE",
  "limite": 10,
  "atual": 10
}
```

> 💡 **Dica**: Quando receber erro 403 com `limitReached: true`, redirecione o usuário para a página de upgrade de plano.

---

### GET /api/dashboard

Retorna estatísticas do advogado autenticado.

**Response (200):**
```json
{
  "success": true,
  "dashboard": {
    "totalProcessos": 15,
    "totalClientes": 8,
    "totalMensagens": 42,
    "mensagensAguardando": 3,
    "mensagensEnviadas": 39
  }
}
```

---

### GET /api/meus-processos

Lista os processos do advogado autenticado.

**Query Params:**
- `limit` (opcional): Número de resultados (padrão: 50)
- `offset` (opcional): Offset para paginação (padrão: 0)

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "numeroCNJ": "...",
      "classe": "...",
      "tomDeVoz": "...",
      "Cliente": {
        "id": "uuid",
        "nome": "João Silva",
        "telefone": "85999999999"
      }
    }
  ],
  "pagination": {
    "total": 15,
    "limit": 50,
    "offset": 0
  }
}
```

---

### PUT /api/mensagens/:id/aprovar

Aprova/edita uma mensagem antes de enviar ao cliente.

**Request:**
```json
{
  "textoTraduzido": "Texto editado pelo advogado",
  "status": "ENVIADA"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "textoTraduzido": "Texto editado pelo advogado",
    "status": "ENVIADA",
    ...
  }
}
```

## 🔐 Segurança

### Boas Práticas

✅ **Sempre use HTTPS em produção**
✅ **Tokens expiram automaticamente** (configurável no Supabase)
✅ **Nunca exponha SUPABASE_SERVICE_ROLE_KEY** (use apenas no backend)
✅ **Valide permissões no banco** com Row Level Security (RLS)

### Row Level Security (RLS)

Configure políticas no Supabase para garantir que:

```sql
-- Exemplo: Advogado só vê seus próprios processos
CREATE POLICY "Advogados veem apenas seus processos"
ON "Processo"
FOR SELECT
USING (auth.uid() = "advogadoId");

-- Exemplo: Advogado só pode inserir processos para si mesmo
CREATE POLICY "Advogados inserem apenas para si"
ON "Processo"
FOR INSERT
WITH CHECK (auth.uid() = "advogadoId");
```

## ⚠️ Tratamento de Erros

### 401 Unauthorized

```json
{
  "error": "Não autorizado",
  "message": "Token inválido ou expirado."
}
```

**Soluções:**
- Verifique se o token está correto
- Faça login novamente se o token expirou
- Use o refresh token para obter um novo access token

### 403 Forbidden

```json
{
  "error": "Acesso negado",
  "message": "Você não tem permissão para editar esta mensagem."
}
```

**Causa:** Tentando acessar recursos de outro usuário.

## 🚀 Próximos Passos

- [ ] Implementar refresh token automático
- [ ] Adicionar rate limiting por usuário
- [ ] Implementar logout (blacklist de tokens)
- [ ] Adicionar roles e permissões customizadas
- [ ] Implementar MFA (Multi-Factor Authentication)

---

💡 **Dica:** Use a biblioteca `@supabase/auth-helpers-nextjs` no frontend para simplificar a autenticação.

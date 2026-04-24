# 🚀 Guia Rápido - JurisZap Backend

Este guia vai te ajudar a configurar e testar a API em **5 minutos**.

## Pré-requisitos

- Node.js 18+ instalado
- NPM ou Yarn
- Conta no [Google AI Studio](https://aistudio.google.com/app/apikey) (gratuito)
- Conta no [Supabase](https://app.supabase.com) (gratuito)
- Chave de API do Datajud CNJ

## 1️⃣ Instalação

```bash
# Clone ou entre na pasta do projeto
cd juriszap-backend

# Instale as dependências
npm install
```

## 2️⃣ Configuração das Variáveis de Ambiente

```bash
# Copie o arquivo de exemplo
cp .env.example .env
```

Edite o arquivo `.env`:

```env
# API do Datajud CNJ
DATAJUD_API_KEY=sua_chave_api_datajud
DATAJUD_TIMEOUT_MS=35000
DATAJUD_RETRY_ATTEMPTS=2
DATAJUD_RETRY_BACKOFF_MS=1200

# Google Gemini AI (obtenha em: https://aistudio.google.com/app/apikey)
GEMINI_API_KEY=sua_chave_gemini_aqui

# Supabase (obtenha em: https://app.supabase.com → Settings → API)
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua_chave_publica_supabase

# Porta do servidor (opcional)
PORT=3000
```

## 3️⃣ Configurar o Banco de Dados Supabase

### 3.1. Execute as Migrations

1. Acesse: https://app.supabase.com
2. Entre no seu projeto
3. Vá em **SQL Editor**
4. Copie TODO o conteúdo de `DATABASE.md`
5. Cole no editor SQL e clique em **RUN**

Isso criará as tabelas:
- ✅ Advogado
- ✅ Cliente
- ✅ Processo
- ✅ Mensagem

### 3.2. Criar um Usuário de Teste

No SQL Editor do Supabase, execute:

```sql
-- Criar advogado de teste
INSERT INTO auth.users (
  instance_id,
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'teste@juriszap.com',
  crypt('123456', gen_salt('bf')),
  NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"nome":"Advogado Teste"}',
  NOW(),
  NOW(),
  'authenticated'
);

-- Criar entrada na tabela Advogado
INSERT INTO "Advogado" (id, nome, email, "createdAt", "updatedAt")
SELECT 
  id,
  'Advogado Teste',
  email,
  NOW(),
  NOW()
FROM auth.users
WHERE email = 'teste@juriszap.com';
```

## 4️⃣ Iniciar o Servidor

```bash
# Modo desenvolvimento (com hot reload)
npm run dev
```

Você deve ver:

```
🚀 Servidor rodando em http://localhost:3000
```

## 5️⃣ Testar a API

### Teste 1: Health Check

```bash
curl http://localhost:3000/health
```

Resposta esperada:
```json
{
  "status": "ok",
  "timestamp": "...",
  "service": "JurisZap Backend API"
}
```

### Teste 2: Login e Obter Token

```bash
# Faça login via Supabase JavaScript Client ou use o dashboard
# Para simplificar, vamos obter o token manualmente
```

**Opção A: Via Supabase Dashboard**
1. Acesse: https://app.supabase.com → Authentication → Users
2. Encontre o usuário `teste@juriszap.com`
3. Clique em "..." → "Generate Access Token"
4. Copie o token JWT

**Opção B: Via API do Supabase** (recomendado)
```bash
curl -X POST 'https://seu-projeto.supabase.co/auth/v1/token?grant_type=password' \
  -H "apikey: SUA_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@juriszap.com",
    "password": "123456"
  }'
```

Salve o `access_token` retornado.

### Teste 3: Salvar um Processo Completo

```bash
# Substitua SEU_TOKEN pelo token obtido acima
export TOKEN="seu_token_jwt_aqui"

curl -X POST http://localhost:3000/api/meus-processos/salvar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "numeroCNJ": "0012345-67.2024.8.26.0100",
    "nomeCliente": "Maria Silva",
    "telefoneCliente": "11987654321",
    "tomDeVoz": "empático e tranquilizador"
  }'
```

**O que acontece nos bastidores:**
1. ✅ Sistema verifica se já existe cliente com telefone `11987654321`
2. ✅ Se não existir, cria novo cliente com nome "Maria Silva"
3. ✅ Consulta o processo no **Datajud**
4. ✅ Traduz a última movimentação com **Gemini AI**
5. ✅ Salva a mensagem traduzida com status `AGUARDANDO`

Resposta esperada:
```json
{
  "success": true,
  "data": {
    "processo": {
      "id": "uuid",
      "numeroCNJ": "0012345-67.2024.8.26.0100",
      "classe": "Procedimento Comum Cível",
      "totalMovimentacoes": 15,
      ...
    },
    "cliente": {
      "id": "uuid",
      "nome": "Maria Silva",
      "telefone": "11987654321"
    },
    "primeiraMensagem": {
      "id": "uuid",
      "textoTraduzido": "Olá Maria! Temos uma atualização...",
      "status": "AGUARDANDO",
      ...
    }
  }
}
```

### Teste 4: Ver Dashboard

```bash
curl http://localhost:3000/api/dashboard \
  -H "Authorization: Bearer $TOKEN"
```

Resposta:
```json
{
  "success": true,
  "dashboard": {
    "totalProcessos": 1,
    "totalClientes": 1,
    "totalMensagens": 1,
    "mensagensAguardando": 1,
    "mensagensEnviadas": 0
  }
}
```

### Teste 5: Aprovar Mensagem

```bash
# Substitua MESSAGE_ID pelo ID da mensagem retornada no Teste 3
export MESSAGE_ID="uuid_da_mensagem"

curl -X PUT "http://localhost:3000/api/mensagens/$MESSAGE_ID/aprovar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "textoTraduzido": "Olá Maria! Temos uma atualização importante sobre seu processo. O juiz recebeu os documentos e está analisando sua solicitação. Isso é um passo positivo! 🎉",
    "status": "APROVADO"
  }'
```

Resposta:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "APROVADO",
    "textoTraduzido": "Olá Maria! Temos uma atualização..."
  }
}
```

## 🎉 Pronto!

Agora você tem:
- ✅ Servidor rodando com TypeScript + Express
- ✅ Integração com Datajud CNJ funcionando
- ✅ Tradução com Gemini AI ativa
- ✅ Autenticação com Supabase configurada
- ✅ Fluxo completo de processo testado

## 📚 Próximos Passos

1. **Explore os endpoints**: Veja `AUTENTICACAO.md` para todos os endpoints disponíveis
2. **Use o script de teste**: Execute `./test-salvar-processo.sh $TOKEN` para testar tudo de uma vez
3. **Implemente WhatsApp**: Integre com API do WhatsApp Business para envio automático
4. **Configure monitoramento**: Crie um CRON job para verificar novos movimentos processuais

## 🐛 Problemas Comuns

### "DATAJUD_API_KEY is required"
- Verifique se você configurou corretamente o `.env`
- Certifique-se de que a variável está exatamente como: `DATAJUD_API_KEY=suachave`

### "GEMINI_API_KEY is required"
- Obtenha sua chave em: https://aistudio.google.com/app/apikey
- Adicione no `.env`: `GEMINI_API_KEY=suachave`

### "Supabase client initialization failed"
- Verifique `SUPABASE_URL` e `SUPABASE_ANON_KEY` no `.env`
- Certifique-se de que o projeto Supabase está ativo

### "401 Unauthorized"
- Verifique se o token JWT está válido (tokens expiram após 1 hora)
- Faça login novamente para obter um novo token

### "Processo not found in Datajud"
- Verifique se o número CNJ é válido e existe no Datajud
- Use um número real de processo para testes

## 💡 Dicas

- Use `npm run exemplo:gemini` para testar apenas o tradutor Gemini sem servidor
- Mantenha o servidor em watch mode com `npm run dev` durante desenvolvimento
- Consulte `DATABASE.md` para entender o schema do banco de dados
- Leia `AUTENTICACAO.md` para detalhes sobre os endpoints protegidos

## 🆘 Suporte

Se encontrar problemas:
1. Verifique os logs do console
2. Confirme que todas as variáveis de ambiente estão configuradas
3. Teste cada integração separadamente (Datajud, Gemini, Supabase)
4. Consulte a documentação oficial de cada serviço

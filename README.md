# JurisZap Backend API

API REST para consulta de processos judiciais através do Datajud CNJ e tradução automática de movimentações processuais para WhatsApp usando Google Gemini AI.

## ✨ Visão Geral

Sistema completo que integra:
- 🏛️ **Datajud CNJ API**: Consulta de processos em mais de 100 tribunais brasileiros
- 🤖 **Google Gemini AI**: Tradução inteligente de jargão jurídico para linguagem simples
- 🔐 **Supabase Auth**: Autenticação JWT e gerenciamento de usuários
- 📱 **WhatsApp Ready**: Mensagens prontas para envio aos clientes
- 🔄 **Fluxo Automatizado**: Da consulta ao Datajud até a mensagem aprovada

### Fluxo Principal

```
Cliente fornece número CNJ
         ↓
Consulta Datajud → Obtém movimentações
         ↓
Gemini AI → Traduz última movimentação
         ↓
Sistema → Salva mensagem para aprovação
         ↓
Advogado → Aprova/edita mensagem
         ↓
[Pronto para envio WhatsApp]
```

## 🚀 Instalação

```bash
# Instalar dependências
npm install

# Configurar variáveis de ambiente
cp .env.example .env
# Edite o arquivo .env e adicione suas chaves de API
```

## ⚙️ Configuração

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
DATAJUD_API_KEY=sua_chave_api_datajud
DATAJUD_TIMEOUT_MS=12000
GEMINI_API_KEY=sua_chave_gemini_aqui
GEMINI_TIMEOUT_MS=15000
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua_chave_publica_supabase
PORT=3000
NODE_ENV=development
LOG_LEVEL=debug
CORS_ORIGINS=
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

### Obtendo as Chaves de API

- **DATAJUD_API_KEY**: Solicite acesso à API do CNJ Datajud
- **GEMINI_API_KEY**: Obtenha gratuitamente em [Google AI Studio](https://aistudio.google.com/app/apikey)
- **SUPABASE_URL** e **SUPABASE_ANON_KEY**: Configure em [Supabase Dashboard](https://app.supabase.com) → Settings → API
- **DATAJUD_TIMEOUT_MS**: Timeout da consulta ao Datajud em milissegundos.
- **GEMINI_TIMEOUT_MS**: Timeout das chamadas ao Gemini em milissegundos.
- **LOG_LEVEL**: Nível de logs (`debug`, `info`, `warn`, `error`). Em produção, use `info` ou `warn`.
- **CORS_ORIGINS**: Lista de origens permitidas (separadas por vírgula). Em produção, configure explicitamente.
- **RATE_LIMIT_WINDOW_MS** e **RATE_LIMIT_MAX**: Controlam o limite de requisições no prefixo `/api`.

## 🏃 Executando

### Modo Desenvolvimento
```bash
npm run dev
```

### Testar o Tradutor Gemini
```bash
npm run exemplo:gemini
```

### Produção
```bash
# Compilar TypeScript
npm run build

# Iniciar servidor
npm start
```

## 📡 Endpoints

### Health Check
Verifica se a API está rodando.

```http
GET /health
```

**Resposta:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-09T10:30:00.000Z",
  "service": "JurisZap Backend API"
}
```

---

### Consultar Processo (GET)
Consulta um processo pelo número CNJ.

```http
GET /api/processos/:numero
```

**Parâmetros:**
- `numero`: Número do processo CNJ (com ou sem formatação)

**Exemplo:**
```bash
curl http://localhost:3000/api/processos/00123456720248260100
```

**Resposta de Sucesso (200):**
```json
{
  "success": true,
  "data": {
    "classe": "Procedimento Comum Cível",
    "dataUltimaAtualizacao": "2024-03-08T14:30:00.000Z",
    "movimentos": [...]
  }
}
```

---

### Consultar Processo (POST)
Consulta um processo enviando o número no body.

```http
POST /api/processos
Content-Type: application/json
```

**Body:**
```json
{
  "numero": "0012345-67.2024.8.26.0100"
}
```

---

### 🤖 Traduzir Última Movimentação com Gemini ✨

Consulta o processo e traduz a movimentação mais recente em linguagem simples para WhatsApp.

```http
GET /api/processos/:numero/traducao?tone=empático
```

**Query Parameters:**
- `tone` (opcional): Tom da mensagem. Ex: "empático", "profissional", "tranquilizador"
  - Padrão: "empático e tranquilizador"

**Exemplo:**
```bash
curl "http://localhost:3000/api/processos/00123456720248260100/traducao?tone=empático"
```

**Resposta de Sucesso (200):**
```json
{
  "success": true,
  "processo": {
    "classe": "Procedimento Comum Criminal",
    "dataUltimaAtualizacao": "2025-12-16T12:49:10.000Z",
    "totalMovimentacoes": 15
  },
  "traducao": {
    "is_relevant_for_client": true,
    "lawyer_summary": "Movimentação de conclusão para decisão traduzida com tom empático, informando que o juiz está analisando o caso.",
    "whatsapp_message": "Olá! 👋 Temos uma atualização sobre seu processo. O juiz recebeu os documentos e está analisando para tomar uma decisão. Isso é um andamento normal e positivo do processo. Continue tranquilo(a), estamos acompanhando tudo.",
    "requires_lawyer_action": false
  }
}
```

---

### 🤖 Traduzir Múltiplas Movimentações ✨

Traduz as N movimentações mais recentes do processo.

```http
POST /api/processos/traducao-multipla
Content-Type: application/json
```

**Body:**
```json
{
  "numero": "0012345-67.2024.8.26.0100",
  "count": 3,
  "tone": "empático e tranquilizador"
}
```

**Parâmetros:**
- `numero` (obrigatório): Número do processo CNJ
- `count` (opcional): Número de movimentações para traduzir (1-10, padrão: 3)
- `tone` (opcional): Tom das mensagens

**Exemplo:**
```bash
curl -X POST http://localhost:3000/api/processos/traducao-multipla \
  -H "Content-Type: application/json" \
  -d '{
    "numero": "0012345-67.2024.8.26.0100",
    "count": 5,
    "tone": "profissional e claro"
  }'
```

**Resposta de Sucesso (200):**
```json
{
  "success": true,
  "processo": {
    "classe": "Procedimento Comum Criminal",
    "dataUltimaAtualizacao": "2025-12-16T12:49:10.000Z",
    "totalMovimentacoes": 15
  },
  "traducoes": [
    {
      "is_relevant_for_client": true,
      "lawyer_summary": "...",
      "whatsapp_message": "...",
      "requires_lawyer_action": false
    },
    // ... mais traduções
  ],
  "count": 3
}
```

---

---

## 📱 Conexão WhatsApp (Baileys)

Rotas protegidas para conectar/desconectar o WhatsApp do advogado sem API da Meta.

### GET /api/whatsapp/status

Retorna o estado atual da conexão do usuário autenticado.

**Resposta (200):**
```json
{
  "success": true,
  "data": {
    "advogadoId": "uuid",
    "status": "disconnected",
    "mode": "qr",
    "updatedAt": "2026-04-11T12:00:00.000Z"
  }
}
```

### POST /api/whatsapp/conectar

Inicia a sessão do WhatsApp em modo QR ou código de pareamento.

**Body (QR):**
```json
{
  "mode": "qr"
}
```

**Body (pairing pelo próprio celular):**
```json
{
  "mode": "pairing",
  "phoneNumber": "5585999999999"
}
```

**Resposta (200):**
```json
{
  "success": true,
  "data": {
    "advogadoId": "uuid",
    "status": "qr_ready",
    "mode": "qr",
    "qrCodeDataUrl": "data:image/png;base64,...",
    "updatedAt": "2026-04-11T12:00:00.000Z"
  }
}
```

Quando `mode` for `pairing`, o retorno terá `pairingCode` em vez de `qrCodeDataUrl`.

### POST /api/whatsapp/desconectar

Desconecta e remove a sessão local do WhatsApp.

**Resposta (200):**
```json
{
  "success": true,
  "data": {
    "advogadoId": "uuid",
    "status": "disconnected",
    "mode": "qr",
    "updatedAt": "2026-04-11T12:00:00.000Z"
  }
}
```

---

## 🤖 Como Funciona o Tradutor Gemini

O serviço de tradução usa o Google Gemini AI para converter "juridiquês" em mensagens simples:

### Processo de Tradução

1. **Extração**: Identifica a movimentação mais recente do processo
2. **Análise Semântica**: O Gemini analisa o significado real para o cliente
3. **Geração de Mensagem**: Cria uma mensagem empática em português (max 3 frases)
4. **Metadados**: Retorna informações sobre relevância e necessidade de ação

### Campos da Resposta

- `is_relevant_for_client`: Se a movimentação é importante para o cliente
- `lawyer_summary`: Resumo técnico para o advogado revisar
- `whatsapp_message`: Mensagem pronta para enviar ao cliente
- `requires_lawyer_action`: Se requer ação imediata do advogado

### Exemplo de Tradução

**Entrada (Datajud):**
```json
{
  "nome": "Conclusão",
  "dataHora": "2025-12-16T12:49:10.000Z",
  "orgaoJulgador": { "nome": "2ª VARA CRIMINAL DA COMARCA DE IGUATU" },
  "complementosTabelados": [{ "nome": "para decisão" }]
}
```

**Saída (Gemini):**
```json
{
  "is_relevant_for_client": true,
  "lawyer_summary": "Movimentação de conclusão para decisão traduzida com tom empático",
  "whatsapp_message": "Olá! 👋 Temos uma atualização sobre seu processo. O juiz recebeu os documentos e está analisando para tomar uma decisão. Isso é um andamento normal e positivo.",
  "requires_lawyer_action": false
}
```

### Tons Disponíveis

Você pode personalizar o tom das mensagens:

- `"empático e tranquilizador"` (padrão) - Uso geral
- `"profissional e claro"` - Clientes corporativos
- `"simples e direto"` - Máxima simplicidade
- `"acolhedor e próximo"` - Casos sensíveis

---

## 🏛️ Tribunais Suportados

A API suporta consultas em todos os tribunais brasileiros:

- **Justiça Estadual** (TJs): Todos os 27 estados
- **Justiça Federal** (TRFs): Regiões 1 a 6
- **Justiça do Trabalho** (TRTs): Regiões 1 a 24
- **Justiça Eleitoral** (TREs): Todos os 27 estados
- **Justiça Militar Estadual**: MG, RS, SP
- **Tribunais Superiores**: STJ, TST, TSE, STM

## 📝 Formato do Número CNJ

O número do processo segue o padrão CNJ:
```
NNNNNNN-DD.AAAA.J.TR.OOOO
```

- **NNNNNNN**: Número sequencial
- **DD**: Dígito verificador
- **AAAA**: Ano
- **J**: Segmento da Justiça (4=Federal, 5=Trabalho, 6=Eleitoral, 8=Estadual, etc)
- **TR**: Tribunal
- **OOOO**: Origem

A API aceita o número com ou sem formatação.

## 🛡️ Tratamento de Erros

### 400 - Bad Request
```json
{
  "error": "Parâmetro inválido",
  "message": "O número do processo é obrigatório."
}
```

### 404 - Not Found
```json
{
  "error": "Processo não encontrado",
  "message": "Não foram encontrados dados para o processo..."
}
```

### 500 - Internal Server Error
```json
{
  "error": "Erro na consulta",
  "message": "Tribunal com código 999 não está disponível no Datajud."
}
```

## 🧪 Testando

### Testar Health Check
```bash
curl http://localhost:3000/health
```

### Testar Consulta de Processo
```bash
# GET
curl http://localhost:3000/api/processos/00123456720248260100

# POST
curl -X POST http://localhost:3000/api/processos \
  -H "Content-Type: application/json" \
  -d '{"numero": "0012345-67.2024.8.26.0100"}'
```

### Testar Tradução com Gemini
```bash
# Traduzir última movimentação
curl "http://localhost:3000/api/processos/00123456720248260100/traducao?tone=empático"

# Traduzir múltiplas movimentações
curl -X POST http://localhost:3000/api/processos/traducao-multipla \
  -H "Content-Type: application/json" \
  -d '{
    "numero": "0012345-67.2024.8.26.0100",
    "count": 3,
    "tone": "empático"
  }'
```

### Executar Exemplo Standalone
```bash
npm run exemplo:gemini
```

---

## 💡 Casos de Uso

### 1. Notificações Automáticas para Clientes
```javascript
// Consultar processo e enviar atualização
const response = await fetch(
  'http://localhost:3000/api/processos/xxx/traducao'
);
const { traducao } = await response.json();

if (traducao.is_relevant_for_client) {
  await enviarWhatsApp(cliente.telefone, traducao.whatsapp_message);
}
```

### 2. Dashboard de Advogados
```javascript
// Ver múltiplas movimentações traduzidas
const response = await fetch(
  'http://localhost:3000/api/processos/traducao-multipla',
  {
    method: 'POST',
    body: JSON.stringify({ numero: 'xxx', count: 5 })
  }
);

const { traducoes } = await response.json();
// Exibir timeline traduzida para revisão
```

### 3. Bot de WhatsApp
```javascript
// Cliente: "Como está meu processo 0012345-67.2024.8.26.0100?"
const { traducao } = await consultarEtraduzir(numeroProcesso);
await bot.reply(traducao.whatsapp_message);
```

---

## 📦 Estrutura do Projeto

```
juriszap-backend/
├── src/
│   ├── datajud.ts           # Serviço de consulta ao Datajud CNJ
│   ├── geminiTranslator.ts  # Tradutor de movimentações com Gemini AI
│   ├── exemploGemini.ts     # Exemplo de uso do tradutor
│   └── server.ts            # Servidor Express com todas as rotas
├── dist/                    # Código compilado (gerado pelo build)
├── .env                     # Variáveis de ambiente (não versionado)
├── .env.example             # Template de configuração
├── package.json
├── tsconfig.json
└── README.md
```

## 🏗️ Arquitetura

### Camadas da Aplicação

1. **API Layer** ([server.ts](src/server.ts))
   - Endpoints REST com Express
   - Validação de requisições
   - Tratamento de erros HTTP

2. **Datajud Service** ([datajud.ts](src/datajud.ts))
   - Consulta à API pública do CNJ
   - Mapeamento de tribunais
   - Normalização de dados

3. **Gemini Translator** ([geminiTranslator.ts](src/geminiTranslator.ts))
   - Tradução de juridiquês
   - Geração de mensagens WhatsApp
   - Análise de relevância

### Fluxo de Dados

```
Cliente → API → Datajud Service → Datajud CNJ
                      ↓
              Gemini Translator → Google Gemini AI
                      ↓
              Mensagem WhatsApp → Cliente
```

---

## 🔐 Segurança

- Nunca compartilhe suas chaves de API (`DATAJUD_API_KEY`, `GEMINI_API_KEY`)
- Adicione `.env` ao `.gitignore`
- Use HTTPS em produção
- Implemente rate limiting se necessário
- Valide e sanitize todas as entradas de usuário

## ⚠️ Limitações e Considerações

### API do Gemini

- **Quota Gratuita**: 15 requisições/minuto, 1500/dia ([Detalhes](https://ai.google.dev/pricing))
- **Latência**: ~1-3 segundos por tradução
- **Custo**: Gratuito até 1500 traduções/dia, depois pago
- **Idioma**: Otimizado para português brasileiro

### API do Datajud

- Verifique os termos de uso do CNJ
- Respeite os limites de requisições
- Alguns tribunais podem ter dados limitados

### Recomendações

1. **Cache**: Implemente cache para evitar consultas duplicadas
2. **Queue**: Use filas para traduções em lote
3. **Logs**: Monitore erros e falhas de tradução
4. **Revisão**: Sempre revise mensagens críticas antes de enviar
5. **Fallback**: Tenha um plano B se a API do Gemini falhar

## 🚀 Próximos Passos

- [ ] Implementar cache Redis para respostas
- [ ] Adicionar autenticação JWT
- [ ] Sistema de filas com Bull/BullMQ
- [ ] Webhooks para notificações assíncronas
- [ ] Testes automatizados (Jest/Vitest)
- [ ] Métricas e observabilidade (Prometheus)
- [ ] Integração direta com WhatsApp Business API
- [ ] Suporte a múltiplos idiomas

## 🤝 Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para:

1. Fazer fork do projeto
2. Criar uma branch para sua feature (`git checkout -b feature/NovaFuncionalidade`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/NovaFuncionalidade`)
5. Abrir um Pull Request

## 📄 Licença

ISC

---

⚖️ **Desenvolvido para JurisZap** - Simplificando a comunicação jurídica com IA


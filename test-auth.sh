#!/bin/bash

# Script de testes para rotas protegidas do JurisZap Backend
# Substitua as variáveis com seus valores reais

# ==========================================
# CONFIGURAÇÃO
# ==========================================

API_URL="http://localhost:3000"
SUPABASE_URL="https://seu-projeto.supabase.co"
SUPABASE_ANON_KEY="sua_chave_anon"
EMAIL="teste@juriszap.com"
PASSWORD="senha123"

# ==========================================
# 1. FAZER LOGIN E OBTER TOKEN
# ==========================================

echo "🔐 Fazendo login..."

LOGIN_RESPONSE=$(curl -s -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${EMAIL}\", \"password\": \"${PASSWORD}\"}")

# Extrai o access_token (requer jq)
ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.access_token')

if [ "$ACCESS_TOKEN" == "null" ] || [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Erro ao fazer login"
  echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login bem-sucedido!"
echo "Token: ${ACCESS_TOKEN:0:20}..."
echo ""

# ==========================================
# 2. TESTAR ROTA PÚBLICA (SEM TOKEN)
# ==========================================

echo "📋 Testando rota pública (health)..."
curl -s "${API_URL}/health" | jq
echo ""

# ==========================================
# 3. TESTAR DASHBOARD (PROTEGIDA)
# ==========================================

echo "📊 Testando dashboard (protegida)..."
curl -s -X GET "${API_URL}/api/dashboard" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" | jq
echo ""

# ==========================================
# 4. SALVAR UM PROCESSO (PROTEGIDA)
# ==========================================

echo "💾 Salvando um processo..."
PROCESSO_RESPONSE=$(curl -s -X POST "${API_URL}/api/meus-processos/salvar" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "numeroCNJ": "0012345-67.2024.8.26.0100",
    "nomeCliente": "Cliente Teste",
    "telefoneCliente": "11999990001",
    "tomDeVoz": "empático e tranquilizador"
  }')

echo "$PROCESSO_RESPONSE" | jq
PROCESSO_ID=$(echo $PROCESSO_RESPONSE | jq -r '.data.processo.id // empty')
echo "ID do processo: $PROCESSO_ID"
echo ""

# ==========================================
# 5. LISTAR PROCESSOS (PROTEGIDA)
# ==========================================

echo "📑 Listando processos..."
curl -s -X GET "${API_URL}/api/meus-processos?limit=10&offset=0" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" | jq
echo ""

# ==========================================
# 6. TESTAR ROTA SEM TOKEN (DEVE RETORNAR 401)
# ==========================================

echo "🚫 Testando rota protegida sem token (deve retornar 401)..."
curl -s -X GET "${API_URL}/api/dashboard" \
  -H "Content-Type: application/json" | jq
echo ""

# ==========================================
# 7. TESTAR COM TOKEN INVÁLIDO (DEVE RETORNAR 401)
# ==========================================

echo "🚫 Testando com token inválido (deve retornar 401)..."
curl -s -X GET "${API_URL}/api/dashboard" \
  -H "Authorization: Bearer token_invalido_123" \
  -H "Content-Type: application/json" | jq
echo ""

echo "✅ Testes concluídos!"

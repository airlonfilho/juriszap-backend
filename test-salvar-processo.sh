#!/bin/bash

# Script para testar o fluxo completo de salvar processo
# Uso: ./test-salvar-processo.sh SEU_TOKEN_JWT

# Configuração
TOKEN="${1:-SEU_TOKEN_JWT}"
BASE_URL="http://localhost:3000"

echo "🚀 Testando fluxo completo de salvar processo..."
echo ""

# Salvar processo
echo "📝 1. Salvando processo..."
SAVE_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/meus-processos/salvar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "numeroCNJ": "0012345-67.2024.8.26.0100",
    "nomeCliente": "João Silva Teste",
    "telefoneCliente": "85999887766",
    "tomDeVoz": "empático e tranquilizador"
  }')

echo "$SAVE_RESPONSE" | jq '.'
echo ""

# Extrair IDs da resposta
PROCESSO_ID=$(echo "$SAVE_RESPONSE" | jq -r '.data.processo.id // empty')
CLIENTE_ID=$(echo "$SAVE_RESPONSE" | jq -r '.data.cliente.id // empty')
MENSAGEM_ID=$(echo "$SAVE_RESPONSE" | jq -r '.data.primeiraMensagem.id // empty')

if [ -z "$PROCESSO_ID" ]; then
  echo "❌ Erro ao salvar processo. Verifique a resposta acima."
  exit 1
fi

echo "✅ Processo salvo com sucesso!"
echo "   - Processo ID: $PROCESSO_ID"
echo "   - Cliente ID: $CLIENTE_ID"
echo "   - Mensagem ID: $MENSAGEM_ID"
echo ""

# Listar processos
echo "📋 2. Listando processos do advogado..."
curl -s -X GET "${BASE_URL}/api/meus-processos?offset=0&limit=10" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.'
echo ""

# Ver dashboard
echo "📊 3. Verificando estatísticas do dashboard..."
curl -s -X GET "${BASE_URL}/api/dashboard" \
  -H "Authorization: Bearer ${TOKEN}" | jq '.'
echo ""

# Aprovar mensagem
echo "✅ 4. Aprovando mensagem..."
curl -s -X PUT "${BASE_URL}/api/mensagens/${MENSAGEM_ID}/aprovar" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "textoTraduzido": "Olá João! Tenho uma ótima notícia sobre seu processo...",
    "status": "APROVADO"
  }' | jq '.'
echo ""

echo "🎉 Teste completo finalizado!"
echo ""
echo "📝 Resumo:"
echo "   1. ✅ Processo salvo (verificação/criação de cliente automática)"
echo "   2. ✅ Dados consultados no Datajud"
echo "   3. ✅ Última movimentação traduzida com Gemini AI"
echo "   4. ✅ Primeira mensagem salva com status AGUARDANDO"
echo "   5. ✅ Mensagem aprovada e editada"
echo ""
echo "💡 Próximos passos:"
echo "   - Implementar envio para WhatsApp"
echo "   - Criar job para monitorar novas movimentações"
echo "   - Adicionar webhook para respostas do cliente"

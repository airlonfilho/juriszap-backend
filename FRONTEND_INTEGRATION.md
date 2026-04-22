# 💻 Guia de Integração Frontend - Pagamentos e Planos

Este documento detalha como o frontend (`juriszap-connect`) deve interagir com o backend para gerenciar assinaturas via Nexano.

## 📡 Endpoints Principais

### 1. Obter Plano Atual
**GET** `/api/planos/me`  
Retorna o plano atual do usuário e o uso de processos.

**Resposta de Exemplo:**
```json
{
  "success": true,
  "data": {
    "plano": {
      "id": "starter",
      "name": "Starter",
      "status": "active",
      "maxProcesses": 10,
      "supportLevel": "suporte padrão",
      "description": "Plano inicial para escritório em operação. 7 dias grátis.",
      "monthlyPriceCents": 9700,
      "currency": "BRL",
      "isCurrent": true
    },
    "uso": {
      "usedProcesses": 5
    }
  }
}
```

---

### 2. Listar Planos Disponíveis
**GET** `/api/planos`  
Retorna a lista de planos que podem ser assinados (Starter e Pro).

---

### 3. Iniciar Checkout (Assinatura)
**POST** `/api/assinaturas/checkouts`

#### **Payload para Pix:**
```json
{
  "planId": "starter",
  "paymentMethod": "PIX",
  "client": {
    "document": "123.456.789-00"
  }
}
```

#### **Payload para Cartão:**
```json
{
  "planId": "pro",
  "paymentMethod": "CARD",
  "clientIp": "127.0.0.1",
  "client": {
    "document": "123.456.789-00"
  },
  "cardInfo": {
    "card": {
      "number": "4444555566667777",
      "owner": "NOME NO CARTAO",
      "expiresAt": "2028-12",
      "cvv": "123"
    }
  }
}
```

#### **Resposta (Pix):**
O backend retorna o objeto da Nexano contendo o QR Code.
```json
{
  "paymentMethod": "pix",
  "pix": {
    "qrcode": "00020101021226850014br.gov.bcb.pix...",
    "qrcodeText": "00020126...",
    "expiresAt": "2024-04-22T14:42:43Z"
  }
}
```

---

## 🚀 Fluxos Sugeridos

### 1. Bloqueio por Limite (Paywall)
Ao tentar salvar um processo (**POST** `/api/meus-processos/salvar`), se o backend responder com `403 Forbidden` e `limitReached: true`, o frontend deve:
1. Exibir um modal ou redirecionar para a página de Planos.
2. Mostrar a mensagem contida no campo `message` da resposta.

### 2. Primeiro Acesso / Usuário Inativo
Se o plano retornado for `id: "inactive"`, o frontend deve exibir um banner ou impedir o acesso às funcionalidades principais, incentivando a assinatura de um plano para iniciar os **7 dias grátis**.

### 3. Script de Atualização (Polling para Pix)
Após exibir o QR Code do Pix, o frontend pode fazer um "check" periódico (polling) no endpoint `/api/planos/me` para verificar se o `plano.id` mudou de `inactive` para `starter`/`pro`. Quando mudar, feche o modal de pagamento e mostre "Sucesso!".

---

## 🔒 Segurança e Dados do Cliente
*   **CPF/CNPJ**: É obrigatório enviar o campo `client.document` no checkout, pois a Nexano exige para emissão da nota e processamento.
*   **IP do Cliente**: Para pagamentos via Cartão, o campo `clientIp` é obrigatório para análise de fraude.

## 🎨 Dicas de UI
*   **Logo**: No `SideNav`, utilize a sigla **JZ** quando estiver recolhido.
*   **Status de Trial**: Exiba uma flag "7 dias grátis" nos botões de assinatura para aumentar a conversão.
## 📱 Conexão WhatsApp

Para saber se o WhatsApp do advogado está vinculado e pronto para enviar mensagens, o frontend deve utilizar o endpoint de status.

### 1. Consultar Status da Conexão
**GET** `/api/whatsapp/status`

**Valores possíveis para `data.status`:**
*   `connected`: WhatsApp pronto para uso (vínculo ativo).
*   `disconnected`: Não há tentativa de conexão ativa.
*   `connecting`: Conexão em andamento.
*   `qr_ready`: Aguardando scan do QR Code (o campo `data.qrCodeDataUrl` conterá a imagem em Base64).
*   `pairing_ready`: Aguardando inserção do código de pareamento (o campo `data.pairingCode` conterá o código).
*   `error`: Ocorreu uma falha na conexão.

**Exemplo de Resposta (Conectado):**
```json
{
  "success": true,
  "data": {
    "status": "connected",
    "updatedAt": "2024-04-22T17:05:20Z"
  }
}
```

---

### 2. Fluxo de Pareamento
O frontend deve monitorar o status do WhatsApp e, caso esteja `disconnected` ou `error`, oferecer ao usuário a opção de "Conectar WhatsApp" via QR Code ou Código de Pareamento.

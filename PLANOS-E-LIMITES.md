# 📊 Sistema de Planos e Limites

O JurisZap Backend implementa um sistema de limites baseado em planos para controlar quantos processos cada advogado pode gerenciar.

## 🎯 Planos Disponíveis

| Plano | Limite de Processos | Limite de WhatsApp | Preço | Ideal Para |
|-------|---------------------|--------------------|-------|------------|
| **STARTER** | 10 processos | 1 WhatsApp | R$ 97/mês | Advogados autônomos |
| **PRO** | 50 processos | 1 WhatsApp | R$ 197/mês | Escritórios em crescimento |

*Todos os planos incluem **7 dias de teste grátis** antes da primeira cobrança.*

## 🔧 Como Funciona

### 1. Middleware `checkProcessLimit`

O middleware é aplicado na rota de salvar processo e verifica automaticamente:

```typescript
app.post('/api/meus-processos/salvar', requireAuth, checkProcessLimit, async (req, res) => {
  // Só chega aqui se estiver dentro do limite
});
```

### 2. Fluxo de Verificação

```
1. Usuário faz POST /api/meus-processos/salvar
         ↓
2. requireAuth valida JWT
         ↓
3. checkProcessLimit consulta:
   - Plano do advogado
   - Total de processos cadastrados
         ↓
4. Compara: atual >= limite?
         ↓
   SIM → Retorna 403 (Forbidden)
   NÃO → Permite salvar processo
```

### 3. Resposta quando Limite Atingido

```json
{
  "success": false,
  "error": "Limite atingido",
  "message": "Você atingiu o limite de 10 processos do plano STARTER. Faça um upgrade para continuar adicionando.",
  "limitReached": true,
  "plano": "STARTER",
  "limite": 10,
  "atual": 10
}
```

## 📝 Configuração Inicial

### No Banco de Dados

A tabela `Advogado` possui a coluna `plano`:

```sql
CREATE TABLE "Advogado" (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  plano VARCHAR(10) DEFAULT 'INACTIVE', -- STARTER, PRO, INACTIVE
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);
```

### Atualizar Plano de um Advogado

```sql
-- Ativar STARTER
UPDATE "Advogado" 
SET plano = 'STARTER', "updatedAt" = NOW()
WHERE id = 'uuid-do-advogado';

-- Upgrade para PRO
UPDATE "Advogado" 
SET plano = 'PRO', "updatedAt" = NOW()
WHERE id = 'uuid-do-advogado';
```

## 🧪 Testes

### Teste 1: Verificar Plano Atual

```bash
# Consultar o advogado logado
curl http://localhost:3000/api/planos/me \
  -H "Authorization: Bearer SEU_TOKEN"
```

### Teste 2: Simular Limite Atingido (Ex: Usuário Inativo)

```bash
# Tentativa de salvar processo sem plano ativo
curl -X POST http://localhost:3000/api/meus-processos/salvar \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "numeroCNJ": "0012345-67.2024.8.26.0100",
    "nomeCliente": "Cliente Teste",
    "telefoneCliente": "11999999999"
  }'
```

**Resposta esperada (INACTIVE - limite 0):**
```json
{
  "success": false,
  "error": "Limite atingido",
  "message": "Você atingiu o limite de 0 processos do plano INACTIVE. Faça um upgrade para continuar adicionando.",
  "limitReached": true,
  "plano": "INACTIVE",
  "limite": 0,
  "atual": 1
}
```

## 💡 Casos de Uso

### Frontend: Exibir Limite no Dashboard

```typescript
// Adicionar ao endpoint GET /api/dashboard
const dashboard = await fetch('/api/dashboard', {
  headers: { 'Authorization': `Bearer ${token}` }
});

const data = await dashboard.json();
console.log(`Processos: ${data.totalProcessos} / ${getLimitForPlan(data.plano)}`);
```

### Alertas Proativos

Você pode criar um sistema de alertas quando o advogado estiver próximo do limite:

```typescript
if (totalAtual >= userLimit * 0.9) {
  console.warn(`⚠️ Advogado ${advogadoId} está em 90% do limite (${totalAtual}/${userLimit})`);
  // Enviar email ou notificação
}
```

### Página de Upgrade

Quando o limite for atingido, redirecione para uma página de upgrade:

```javascript
if (response.limitReached) {
  window.location.href = '/upgrade?plan=' + response.plano;
}
```

## 🔐 Segurança

### Proteção por Row Level Security (RLS)

```sql
-- Advogado só pode ver seus próprios processos
CREATE POLICY advogado_own_processos ON "Processo"
  FOR SELECT
  USING (auth.uid() = "advogadoId");
```

### Validação no Backend

O middleware **sempre** valida no backend, mesmo que o frontend implemente verificações. Nunca confie apenas em validações client-side.

## 📈 Monitoramento

### Consultar Uso por Plano

```sql
-- Ver distribuição de processos por plano
SELECT 
  a.plano,
  COUNT(DISTINCT a.id) as total_advogados,
  COUNT(p.id) as total_processos,
  AVG(processos_por_advogado.count) as media_processos
FROM "Advogado" a
LEFT JOIN "Processo" p ON p."advogadoId" = a.id
LEFT JOIN (
  SELECT "advogadoId", COUNT(*) as count
  FROM "Processo"
  GROUP BY "advogadoId"
) processos_por_advogado ON processos_por_advogado."advogadoId" = a.id
GROUP BY a.plano;
```

### Identificar Advogados Próximos do Limite

```sql
-- Advogados com mais de 80% do limite
SELECT 
  a.id,
  a.nome,
  a.email,
  a.plano,
  COUNT(p.id) as processos_atual,
  CASE 
    WHEN a.plano = 'FREE' THEN 10
    WHEN a.plano = 'PRO' THEN 50
    WHEN a.plano = 'ENTERPRISE' THEN 100
  END as limite,
  (COUNT(p.id)::float / 
    CASE 
      WHEN a.plano = 'FREE' THEN 10
      WHEN a.plano = 'PRO' THEN 50
      WHEN a.plano = 'ENTERPRISE' THEN 100
    END * 100
  ) as percentual_uso
FROM "Advogado" a
LEFT JOIN "Processo" p ON p."advogadoId" = a.id
GROUP BY a.id, a.nome, a.email, a.plano
HAVING (COUNT(p.id)::float / 
  CASE 
    WHEN a.plano = 'FREE' THEN 10
    WHEN a.plano = 'PRO' THEN 50
    WHEN a.plano = 'ENTERPRISE' THEN 100
  END * 100
) > 80
ORDER BY percentual_uso DESC;
```

## 🚀 Próximos Passos

1. **Sistema de Pagamentos**: Integrar Stripe ou Pagar.me para upgrades automáticos
2. **Webhooks**: Notificar quando advogado atingir 90% do limite
3. **Analytics**: Dashboard admin para ver uso por plano
4. **Grandfathering**: Manter limites antigos para clientes existentes durante mudanças
5. **Trial Periods**: Oferecer período de teste do PRO para usuários FREE

## 📞 Suporte

Se um advogado precisar de um limite customizado, você pode:

```sql
-- Criar plano customizado (requer alteração no código)
UPDATE "Advogado" 
SET plano = 'CUSTOM_1000'
WHERE id = 'uuid-do-advogado';
```

E adicionar no middleware:

```typescript
const LIMITS: LimitesPlano = {
  FREE: 10,
  PRO: 50,
  ENTERPRISE: 100,
  CUSTOM_1000: 1000 // Plano customizado
};
```

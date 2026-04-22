# Schema do Banco de Dados - JurisZap

Estrutura das tabelas no PostgreSQL (Supabase).

## 📊 Tabelas

### Advogado
Representa os advogados cadastrados na plataforma.

```sql
CREATE TABLE "Advogado" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  nome VARCHAR(255) NOT NULL,
  plano VARCHAR(50) DEFAULT 'FREE', -- FREE, PRO, ENTERPRISE
  telefone VARCHAR(20),
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);
```

### Cliente
Clientes dos advogados.

```sql
CREATE TABLE "Cliente" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(255) NOT NULL,
  telefone VARCHAR(20) NOT NULL,
  advogadoId UUID NOT NULL REFERENCES "Advogado"(id) ON DELETE CASCADE,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cliente_advogado ON "Cliente"(advogadoId);
```

### Processo
Processos judiciais acompanhados.

```sql
CREATE TABLE "Processo" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numeroCNJ VARCHAR(25) NOT NULL,
  classe VARCHAR(255),
  tomDeVoz VARCHAR(100) DEFAULT 'empático e tranquilizador',
  advogadoId UUID NOT NULL REFERENCES "Advogado"(id) ON DELETE CASCADE,
  clienteId UUID REFERENCES "Cliente"(id) ON DELETE SET NULL,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),
  UNIQUE(numeroCNJ, advogadoId)
);

CREATE INDEX idx_processo_advogado ON "Processo"(advogadoId);
CREATE INDEX idx_processo_cliente ON "Processo"(clienteId);
CREATE INDEX idx_processo_cnj ON "Processo"(numeroCNJ);
```

### Mensagem
Movimentações processuais traduzidas.

```sql
CREATE TABLE "Mensagem" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dataMovimentacao TIMESTAMP NOT NULL,
  textoTecnico TEXT NOT NULL,
  textoTraduzido TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'AGUARDANDO', -- AGUARDANDO, ENVIADA, ERRO
  processoId UUID NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_mensagem_processo ON "Mensagem"(processoId);
CREATE INDEX idx_mensagem_status ON "Mensagem"(status);
```

## 🔒 Row Level Security (RLS)

Configure políticas de segurança para proteger os dados:

### Advogado

```sql
-- Habilita RLS
ALTER TABLE "Advogado" ENABLE ROW LEVEL SECURITY;

-- Advogado vê apenas seus próprios dados
CREATE POLICY "Advogados veem apenas seus dados"
ON "Advogado"
FOR SELECT
USING (auth.uid() = id);

-- Advogado pode atualizar apenas seus dados
CREATE POLICY "Advogados atualizam apenas seus dados"
ON "Advogado"
FOR UPDATE
USING (auth.uid() = id);
```

### Cliente

```sql
ALTER TABLE "Cliente" ENABLE ROW LEVEL SECURITY;

-- Advogado vê apenas seus clientes
CREATE POLICY "Advogados veem apenas seus clientes"
ON "Cliente"
FOR ALL
USING (auth.uid() = advogadoId);
```

### Processo

```sql
ALTER TABLE "Processo" ENABLE ROW LEVEL SECURITY;

-- Advogado vê apenas seus processos
CREATE POLICY "Advogados veem apenas seus processos"
ON "Processo"
FOR SELECT
USING (auth.uid() = advogadoId);

-- Advogado pode inserir processos apenas para si
CREATE POLICY "Advogados inserem apenas para si"
ON "Processo"
FOR INSERT
WITH CHECK (auth.uid() = advogadoId);

-- Advogado pode atualizar apenas seus processos
CREATE POLICY "Advogados atualizam apenas seus processos"
ON "Processo"
FOR UPDATE
USING (auth.uid() = advogadoId);

-- Advogado pode deletar apenas seus processos
CREATE POLICY "Advogados deletam apenas seus processos"
ON "Processo"
FOR DELETE
USING (auth.uid() = advogadoId);
```

### Mensagem

```sql
ALTER TABLE "Mensagem" ENABLE ROW LEVEL SECURITY;

-- Advogado vê mensagens dos seus processos
CREATE POLICY "Advogados veem mensagens dos seus processos"
ON "Mensagem"
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM "Processo"
    WHERE "Processo".id = "Mensagem".processoId
    AND "Processo".advogadoId = auth.uid()
  )
);

-- Advogado pode inserir mensagens em seus processos
CREATE POLICY "Advogados inserem mensagens nos seus processos"
ON "Mensagem"
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM "Processo"
    WHERE "Processo".id = processoId
    AND "Processo".advogadoId = auth.uid()
  )
);

-- Advogado pode atualizar mensagens dos seus processos
CREATE POLICY "Advogados atualizam mensagens dos seus processos"
ON "Mensagem"
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM "Processo"
    WHERE "Processo".id = "Mensagem".processoId
    AND "Processo".advogadoId = auth.uid()
  )
);
```

## 🚀 Migrações

### Script de Criação Completo

Execute no **Supabase SQL Editor**:

```sql
-- Habilita extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Cria tabelas
CREATE TABLE "Advogado" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  nome VARCHAR(255) NOT NULL,
  plano VARCHAR(50) DEFAULT 'FREE',
  telefone VARCHAR(20),
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

CREATE TABLE "Cliente" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(255) NOT NULL,
  telefone VARCHAR(20) NOT NULL,
  advogadoId UUID NOT NULL REFERENCES "Advogado"(id) ON DELETE CASCADE,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

CREATE TABLE "Processo" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numeroCNJ VARCHAR(25) NOT NULL,
  classe VARCHAR(255),
  tomDeVoz VARCHAR(100) DEFAULT 'empático e tranquilizador',
  advogadoId UUID NOT NULL REFERENCES "Advogado"(id) ON DELETE CASCADE,
  clienteId UUID REFERENCES "Cliente"(id) ON DELETE SET NULL,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),
  UNIQUE(numeroCNJ, advogadoId)
);

CREATE TABLE "Mensagem" (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dataMovimentacao TIMESTAMP NOT NULL,
  textoTecnico TEXT NOT NULL,
  textoTraduzido TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'AGUARDANDO',
  processoId UUID NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW()
);

-- Cria índices
CREATE INDEX idx_cliente_advogado ON "Cliente"(advogadoId);
CREATE INDEX idx_processo_advogado ON "Processo"(advogadoId);
CREATE INDEX idx_processo_cliente ON "Processo"(clienteId);
CREATE INDEX idx_processo_cnj ON "Processo"(numeroCNJ);
CREATE INDEX idx_mensagem_processo ON "Mensagem"(processoId);
CREATE INDEX idx_mensagem_status ON "Mensagem"(status);

-- Habilita RLS em todas as tabelas
ALTER TABLE "Advogado" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Cliente" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Processo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Mensagem" ENABLE ROW LEVEL SECURITY;

-- Políticas RLS (adicione as políticas acima aqui)
```

## 📝 Relacionamentos

```
Advogado (1) ──── (N) Cliente
Advogado (1) ──── (N) Processo
Cliente (1) ──── (N) Processo
Processo (1) ──── (N) Mensagem
```

## 🔗 Integração com Supabase Auth

O campo `id` da tabela `Advogado` deve corresponder ao `id` do usuário no `auth.users`:

```sql
-- Trigger para criar registro de Advogado ao criar usuário
CREATE OR REPLACE FUNCTION criar_advogado_ao_registrar()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO "Advogado" (id, email, nome)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION criar_advogado_ao_registrar();
```

---

💡 **Dica:** Execute todas as políticas RLS para garantir que cada advogado acesse apenas seus próprios dados.

# JurisZap Backend - Visão Geral do Projeto

## 📝 O que é o projeto?

O **JurisZap Backend** é uma API REST robusta desenvolvida em Node.js e TypeScript, projetada para simplificar a comunicação entre advogados e clientes. O sistema automatiza o acompanhamento de processos judiciais e a tradução de andamentos complexos ("juridiquês") para uma linguagem simples e acessível, pronta para ser enviada via WhatsApp.

### Principais Funcionalidades:
- **Consulta Datajud (CNJ):** Integração com a API pública do CNJ para buscar movimentações de processos em todos os tribunais brasileiros.
- **Inteligência Artificial (Gemini/OpenRouter):** Uso de LLMs para traduzir a última movimentação em uma mensagem empática e clara para o cliente.
- **Gestão de WhatsApp (Baileys):** Conexão direta com o WhatsApp do advogado (via QR Code ou Pairing Code) sem depender da API oficial da Meta.
- **Sistema de Planos e Limites:** Controle de uso baseado em trilhas (FREE, PRO, ENTERPRISE), limitando o número de processos por advogado.
- **Autenticação Segura:** Integração com Supabase Auth (JWT) e Row Level Security (RLS) no banco de dados.

---

## 📍 Onde estamos? (Status Atual)

O projeto encontra-se em uma fase avançada de desenvolvimento core, com as principais integrações já funcionais:

1.  **Infraestrutura:** Servidor Express configurado com suporte a TypeScript, variáveis de ambiente e tratamento de erros.
2.  **Serviços de IA:** Tradutor Gemini e OpenRouter implementados e testados.
3.  **Integração Datajud:** Serviço de consulta ao CNJ normalizado e operante.
4.  **WhatsApp Service:** Módulo de conexão via Baileys finalizado, permitindo autenticação multi-dispositivo.
5.  **Banco de Dados:** Schema PostgreSQL (Supabase) definido com tabelas para Advogados, Clientes, Processos e Mensagens.
6.  **Segurança:** Middlewares de autenticação e limites de processos por plano já codificados.

---

## 🛠️ O que falta para finalizar?

Para que o sistema esteja pronto para produção em larga escala, os seguintes pontos precisam de atenção:

### 1. Pagamentos e Assinaturas
- [x] Integração com **Nexano** para automatizar o upgrade de planos e cobranças recorrentes.
- [x] Webhooks de pagamento para atualizar o status do plano do advogado em tempo real.
    - *Nota: Implementado endpoints de checkout para Pix e Cartão.*
    - *Ação necessária: Configurar chaves reais no .env e Webhook no painel da Nexano.*

### 2. Performance e Escalabilidade
- [ ] Implementação de **Redis Cache** para evitar consultas repetitivas ao Datajud e reduzir latência.
- [ ] Sistema de filas (**BullMQ/Redis**) para processar traduções e envios em lote sem travar a thread principal.

### 3. Confiabilidade e Qualidade
- [ ] Criação de uma suíte completa de **testes automatizados** (Jest ou Vitest), cobrindo mocks de APIs externas.
- [ ] Implementação de logs estruturados e monitoramento (Prometheus/Grafana ou Sentry).

### 4. Melhorias na Experiência (UX/Dev)
- [ ] Sistema de **Webhooks** para notificar sistemas externos (ou o frontend) sobre novas movimentações encontradas.
- [ ] Dashboard administrativo para visualização de métricas de uso e saúde do sistema.
- [ ] Suporte opcional à WhatsApp Business API (oficial) para clientes de nível Enterprise.

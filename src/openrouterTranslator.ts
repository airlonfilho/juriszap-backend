import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_OPENROUTER_TIMEOUT_MS = 15000;
const DEFAULT_OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free';
const DEFAULT_OPENROUTER_FALLBACK_MODELS = [
    'openai/gpt-oss-120b:free',
    'google/gemma-2-9b-it:free',
    'microsoft/phi-3-mini-128k-instruct:free',
    'qwen/qwen-2.5-7b-instruct:free',
    'openrouter/auto',
] as const;

function getOpenRouterTimeoutMs(): number {
    const rawTimeout = Number(process.env.OPENROUTER_TIMEOUT_MS || DEFAULT_OPENROUTER_TIMEOUT_MS);
    if (!Number.isFinite(rawTimeout) || rawTimeout <= 0) {
        return DEFAULT_OPENROUTER_TIMEOUT_MS;
    }

    return rawTimeout;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(message));
        }, timeoutMs);

        promise
            .then((result) => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch((error: unknown) => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

function extractJsonText(rawText: string): string {
    const trimmed = rawText.trim();

    if (trimmed.startsWith('```')) {
        const inner = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        if (inner) return inner;
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }

    return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeErrorText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

export function getGeminiFriendlyErrorMessage(error: unknown): string {
    const rawMessage = error instanceof Error ? error.message : String(error || '');
    const message = normalizeErrorText(rawMessage);

    if (message.includes('timeout') || message.includes('timed out')) {
        return 'A tradução demorou mais que o esperado. Tente novamente em instantes.';
    }

    if (message.includes('401') || message.includes('invalid api key') || message.includes('unauthorized')) {
        return 'A chave do OpenRouter não está válida. Verifique a variável OPENROUTER_API_KEY.';
    }

    if (
        message.includes('403')
        || message.includes('permission')
        || message.includes('denied access')
        || message.includes('forbidden')
        || message.includes('project has been denied access')
    ) {
        return 'O serviço de tradução está indisponível no momento para esta conta. Tente novamente mais tarde.';
    }

    if (message.includes('429') || message.includes('quota') || message.includes('rate limit') || message.includes('too many requests')) {
        return 'O serviço de tradução recebeu muitas solicitações. Tente novamente em instantes.';
    }

    if (message.includes('model') && (message.includes('not found') || message.includes('unavailable'))) {
        return 'O modelo de tradução está temporariamente indisponível. Tente novamente em instantes.';
    }

    if (message.includes('no endpoints found')) {
        return 'O modelo configurado não está disponível no OpenRouter no momento. Use outro modelo gratuito.';
    }

    if (message.includes('json') || message.includes('parse') || message.includes('invalid response format')) {
        return 'A resposta da IA veio em formato inválido. Tente novamente em instantes.';
    }

    return 'Não foi possível traduzir a movimentação agora. Tente novamente em instantes.';
}

// ==========================================
// STEP 1: DEFINIÇÃO DAS INTERFACES
// ==========================================

type TomDeVoz = 'EMPATICO' | 'OBJETIVO' | 'DESCONTRAIDO' | 'FORMAL';

interface OrgaoJulgador {
    nome: string;
}

interface ComplementoTabelado {
    nome?: string;
    descricao?: string;
    [key: string]: unknown;
}

export interface DatajudMovement {
    nome?: string;
    dataHora?: string;
    orgaoJulgador?: OrgaoJulgador;
    complementosTabelados?: ComplementoTabelado[];
    [key: string]: unknown;
}

export interface GeminiTranslationResult {
    is_relevant_for_client: boolean;
    lawyer_summary: string;
    whatsapp_message: string;
    requires_lawyer_action: boolean;
}

export interface TranslationPartyContext {
    clientName?: string;
    clientRole?: string;
    clientSide?: 'ATIVO' | 'PASSIVO' | 'INDEFINIDO';
    counterpartName?: string;
    counterpartRole?: string;
}

function buildRoleSpecificGuidance(partyContext?: TranslationPartyContext): string {
    if (!partyContext?.clientRole) return '';

    const role = partyContext.clientRole
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    if (role.includes('QUERELADO') || role.includes('ACUSADO') || partyContext.clientSide === 'PASSIVO') {
        return `\n=== DEFENSE-SENSITIVE GUIDANCE ===\n- The client is the defendant/accused side and is being defended by the lawyer.\n- Use neutral, careful language and preserve presumption of innocence.\n- NEVER use wording that implies guilt, confession, or fault attribution.\n- Emphasize rights, procedural guarantees, and strategic legal follow-up.\n`;
    }

    if (role.includes('QUERELANTE') || role.includes('AUTOR') || partyContext.clientSide === 'ATIVO') {
        return `\n=== PLAINTIFF-SIDE GUIDANCE ===\n- The client is the claimant/plaintiff side.\n- Explain progress from the perspective of rights enforcement and case advancement.\n- Keep confidence and clarity, but without guarantees of outcome.\n`;
    }

    return '';
}

interface OpenRouterChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenRouterChatResponse {
    choices?: Array<{
        message?: {
            content?: string | null;
        };
    }>;
}

function getOpenRouterCandidateModels(): string[] {
    const primary = process.env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;
    const envFallback = (process.env.OPENROUTER_FALLBACK_MODELS || '')
        .split(',')
        .map((model) => model.trim())
        .filter((model) => model.length > 0);

    const combined = [primary, ...envFallback, ...DEFAULT_OPENROUTER_FALLBACK_MODELS];
    return [...new Set(combined)];
}

function buildSystemPrompt(desiredTone: string): string {
    return `You are an expert in Brazilian procedural law and a specialist in empathetic client communication.
Your task is to translate technical legal movements ("juridiquês") from the Brazilian CNJ Datajud API into simple, reassuring WhatsApp messages for layperson clients.

Rules:
- NEVER use repetitive robotic openings like "Olá! Recebemos uma atualização".
- NEVER use legal jargon ("juridiquês") in the message.
- NEVER give legal advice, predict outcomes, or make promises.
- NEVER use emojis. Write natural, human messages without any emoji.
- Explain the update in maximum 3 short sentences.
- If it's pure internal bureaucracy, reassure them the process is moving normally.

You MUST adapt the tone according to the requested style (${desiredTone}):
- If "EMPATICO": Use a warm, reassuring voice. Focus on peace of mind. Example opening: "Oi! Tenho boas notícias sobre seu processo..."
- If "OBJETIVO": Be fast and crystal clear. No fluff. Example opening: "Olá. Seu processo teve uma atualização hoje."
- If "DESCONTRAIDO": Be very informal, like a friend messaging. Example opening: "Passando rapidinho pra avisar que houve uma atualização..."
- If "FORMAL": Be respectful and classic, but understandable. Address as "Prezado(a)". Example opening: "Prezado(a), informamos que houve andamento em seu processo..."

Return ONLY a valid JSON object matching this schema exactly:
{
  "is_relevant_for_client": boolean,
  "lawyer_summary": "string",
  "whatsapp_message": "string",
  "requires_lawyer_action": boolean
}`;
}

// ==========================================
// MOVIMENTO CLASSIFICATION & MAPPING
// ==========================================

interface MovementTypeMapping {
    keywords: string[];
    description: string;
    clientImpact: string;
    requiresAction: boolean;
    urgency: 'baixa' | 'média' | 'alta';
}

const MOVEMENT_TYPE_MAP: Record<string, MovementTypeMapping> = {
    DISTRIBUTIVO: {
        keywords: ['distribui', 'recebimento', 'autuação'],
        description: 'Ação foi registrada e distribuída para um juiz',
        clientImpact: 'Seu processo passou a existir formalmente no sistema do tribunal',
        requiresAction: false,
        urgency: 'baixa'
    },
    INTIMACAO: {
        keywords: ['intima', 'citação', 'notifica'],
        description: 'Cliente foi intimado (notificado oficialmente) para aparecer em juízo',
        clientImpact: 'Você precisa comparecer ou enviar documentos conforme a intimação',
        requiresAction: true,
        urgency: 'alta'
    },
    SENTENCA: {
        keywords: ['sentença', 'julgamento', 'sentenciado'],
        description: 'Juiz proferiu sentença (decisão final sobre o mérito)',
        clientImpact: 'Há uma decisão do juiz. Você pode ter ganhado, perdido ou empatado',
        requiresAction: true,
        urgency: 'alta'
    },
    APELACAO: {
        keywords: ['apelação', 'recurso', 'apelado', 'agravante'],
        description: 'Houve apresentação ou julgamento de apelação (recurso)',
        clientImpact: 'O caso foi levado a um tribunal superior para revisão',
        requiresAction: false,
        urgency: 'média'
    },
    AUDIENCIA: {
        keywords: ['audiência', 'conciliação', 'mediação', 'julgamento marcado'],
        description: 'Uma audiência foi marcada ou realizada',
        clientImpact: 'Haverá (ou houve) uma reunião formal em juízo',
        requiresAction: true,
        urgency: 'alta'
    },
    PETICIONAMENTO: {
        keywords: ['petição', 'peticionado', 'documentos enviados', 'recurso enviado'],
        description: 'Documentos foram enviados ao tribunal',
        clientImpact: 'Novas informações foram incluídas no seu processo',
        requiresAction: false,
        urgency: 'baixa'
    },
    ARQUIVAMENTO: {
        keywords: ['arquivo', 'encerrado', 'encerramento', 'findado'],
        description: 'Processo foi arquivado ou encerrado',
        clientImpact: 'Seu processo chegou ao fim',
        requiresAction: false,
        urgency: 'média'
    },
    EXECUCAO: {
        keywords: ['execução', 'penhora', 'exigível', 'executado'],
        description: 'Fase de execução foi iniciada para cobrar a condenação',
        clientImpact: 'O tribunal está executando a sentença (cobrando a dívida)',
        requiresAction: true,
        urgency: 'alta'
    },
    ADMINISTRATIVO: {
        keywords: ['protocolo', 'recebimento de', 'juntada', 'certificado', 'publicado'],
        description: 'Atividade administrativa interna do tribunal',
        clientImpact: 'O processo segue andando normalmente nos bastidores',
        requiresAction: false,
        urgency: 'baixa'
    }
};

function classifyMovementType(movementName: string): string {
    const normalized = (movementName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    for (const [typeName, mapping] of Object.entries(MOVEMENT_TYPE_MAP)) {
        if (mapping.keywords.some(keyword => normalized.includes(keyword))) {
            return typeName;
        }
    }
    
    return 'ADMINISTRATIVO';
}

function buildUserPrompt(
    movement: DatajudMovement,
    processClass: string,
    desiredTone: string,
    partyContext?: TranslationPartyContext
): string {
    const movementName = movement.nome || 'Não informado';
    const movementDetail = movement.complementosTabelados?.[0]?.nome || movement.complementosTabelados?.[0]?.descricao || '';
    const courtName = movement.orgaoJulgador?.nome || 'Não informado';
    const movementType = classifyMovementType(movementName);
    const typeInfo = MOVEMENT_TYPE_MAP[movementType] ?? MOVEMENT_TYPE_MAP['ADMINISTRATIVO'];
    const roleGuidanceBlock = buildRoleSpecificGuidance(partyContext);
    const clientContextBlock = partyContext?.clientName
        ? `\n=== CLIENT PARTY CONTEXT ===\n- Client Name: ${partyContext.clientName}\n- Client Role in case: ${partyContext.clientRole || 'NÃO_IDENTIFICADO'}\n- Client Side: ${partyContext.clientSide || 'INDEFINIDO'}\n- Counterpart Name: ${partyContext.counterpartName || 'NÃO_IDENTIFICADO'}\n- Counterpart Role: ${partyContext.counterpartRole || 'NÃO_IDENTIFICADO'}\n`
        : '';

    return `Analyze the following court movement data and categorize it for a layperson client:

=== MOVEMENT CLASSIFICATION ===
- Category: ${movementType}
- Type Description: ${typeInfo!.description}
- Client Impact: ${typeInfo!.clientImpact}
- Requires Action: ${typeInfo!.requiresAction ? 'YES' : 'NO'}
- Urgency: ${typeInfo!.urgency.toUpperCase()}

=== PROCESS INFORMATION ===
- Process Class: ${processClass}
- Movement Name: ${movementName}
- Movement Detail: ${movementDetail}
- Court/Location: ${courtName}
- Requested Tone: ${desiredTone}
${clientContextBlock}
${roleGuidanceBlock}

=== TRANSLATION INSTRUCTIONS ===
Task 1: Semantic Translation
- Translate the technical legal movement into everyday language
- Focus on: What happened? Why does it matter to the client? Do they need to do anything?
- Use the Category and Client Impact above as guidance
- Discard purely internal bureaucratic tasks unless critical

Task 2: Message Generation  
- Write a human, engaging WhatsApp message in PT-BR (maximum 3 short sentences)
- ALWAYS start with or use the client name naturally (e.g., "Olá João" or "João, tenho notícias...") to feel personal and human
- Always explain WHAT happened in simple terms
- Always explain WHY it matters to the client
- Adapt wording according to the client role:
    - If client is PASSIVO/QUERELADO/ACUSADO: be extra careful, neutral and protective; avoid language that presumes guilt.
    - If client is ATIVO/QUERELANTE/AUTOR: highlight procedural progress and strategic expectations.
- Mention ACTION REQUIRED if ${typeInfo!.requiresAction}
- Match the requested tone: ${desiredTone}
- NEVER use emojis or special symbols
- NEVER repeat generic lines like "Recebemos uma atualização do CNJ"

Task 3: Lawyer Summary
- Provide a 1-sentence summary in PT-BR for the lawyer to quickly review
- Focus on what changed and why it's significant`;
}

async function callOpenRouter(messages: OpenRouterChatMessage[]): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY não configurada. Adicione a chave no arquivo .env');
    }

    const timeoutMs = getOpenRouterTimeoutMs();
    const models = getOpenRouterCandidateModels();
    let lastError: unknown;

    for (const model of models) {
        const response = await withTimeout(
            fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
                    'X-Title': process.env.OPENROUTER_APP_NAME || 'juriszap-backend',
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: 0.2,
                    max_tokens: 700,
                }),
            }),
            timeoutMs,
            'Timeout ao consultar OpenRouter. Tente novamente em instantes.'
        );

        if (!response.ok) {
            const errorText = await response.text();
            lastError = new Error(`OpenRouter ${response.status}: ${errorText}`);

            const normalized = normalizeErrorText(errorText);
            const shouldTryNextModel = response.status === 404 && normalized.includes('no endpoints found');
            if (shouldTryNextModel) {
                continue;
            }

            throw lastError;
        }

        const payload = (await response.json()) as OpenRouterChatResponse;
        const content = payload.choices?.[0]?.message?.content;

        if (typeof content !== 'string' || !content.trim()) {
            lastError = new Error('OpenRouter não retornou conteúdo válido.');
            continue;
        }

        return content;
    }

    throw lastError instanceof Error
        ? lastError
        : new Error('OpenRouter não retornou conteúdo válido.');
}

function validateTranslationResult(value: unknown): GeminiTranslationResult {
    if (!isRecord(value)) {
        throw new Error('A resposta da IA veio em formato inválido. Tente novamente em instantes.');
    }

    const isRelevant = value.is_relevant_for_client;
    const lawyerSummary = value.lawyer_summary;
    const whatsappMessage = value.whatsapp_message;
    const requiresAction = value.requires_lawyer_action;

    if (
        typeof isRelevant !== 'boolean'
        || typeof lawyerSummary !== 'string'
        || typeof whatsappMessage !== 'string'
        || typeof requiresAction !== 'boolean'
    ) {
        throw new Error('A resposta da IA veio em formato inválido. Tente novamente em instantes.');
    }

    return {
        is_relevant_for_client: isRelevant,
        lawyer_summary: lawyerSummary.trim(),
        whatsapp_message: whatsappMessage.trim(),
        requires_lawyer_action: requiresAction,
    };
}

export async function translateLatestMovement(
    movements: DatajudMovement[],
    processClass: string,
    desiredTone: string = 'empático e tranquilizador',
    partyContext?: TranslationPartyContext
): Promise<GeminiTranslationResult> {
    if (!movements || movements.length === 0) {
        throw new Error('Array de movimentações está vazio. Não há dados para traduzir.');
    }

    const sortedMovements = [...movements].sort((a, b) => {
        const dateA = new Date(a.dataHora || 0).getTime();
        const dateB = new Date(b.dataHora || 0).getTime();
        return dateB - dateA;
    });

    const latestMovement = sortedMovements[0];

    if (!latestMovement) {
        throw new Error('Não foi possível extrair a movimentação mais recente.');
    }

    try {
        console.log('Chamando OpenRouter para traduzir movimentação...');
        const content = await callOpenRouter([
            {
                role: 'system',
                content: buildSystemPrompt(desiredTone),
            },
            {
                role: 'user',
                content: buildUserPrompt(latestMovement, processClass, desiredTone, partyContext),
            },
        ]);

        const parsed = JSON.parse(extractJsonText(content));
        const translationResult = validateTranslationResult(parsed);

        console.log(`Mensagem WhatsApp gerada: "${translationResult.whatsapp_message.substring(0, 50)}..."`);
        return translationResult;
    } catch (error) {
        console.error('Erro ao traduzir movimentação com OpenRouter:', error);

        if (error instanceof SyntaxError) {
            throw new Error('A resposta da IA veio em formato inválido. Tente novamente em instantes.');
        }

        throw new Error(getGeminiFriendlyErrorMessage(error));
    }
}

export async function translateMultipleMovements(
    movements: DatajudMovement[],
    processClass: string,
    count: number = 3,
    desiredTone: string = 'empático e tranquilizador',
    partyContext?: TranslationPartyContext
): Promise<GeminiTranslationResult[]> {
    if (!movements || movements.length === 0) {
        throw new Error('Array de movimentações está vazio.');
    }

    const sortedMovements = [...movements].sort((a, b) => {
        const dateA = new Date(a.dataHora || 0).getTime();
        const dateB = new Date(b.dataHora || 0).getTime();
        return dateB - dateA;
    });

    const recentMovements = sortedMovements.slice(0, count);
    const results: GeminiTranslationResult[] = [];

    for (let i = 0; i < recentMovements.length; i++) {
        const movement = recentMovements[i];
        if (!movement) continue;

        const result = await translateLatestMovement([movement], processClass, desiredTone, partyContext);
        results.push(result);
    }

    return results;
}
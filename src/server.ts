import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import type { CorsOptions } from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import { consultarProcesso } from './datajud.js';
import { getGeminiFriendlyErrorMessage, translateLatestMovement } from './openrouterTranslator.js';
import type { DatajudMovement, TranslationPartyContext } from './openrouterTranslator.js';
import type { ProcessoParteEnvolvida } from './datajud.js';
import { requireAuth } from './middleware/auth.js';
import { checkProcessLimit } from './middleware/limits.js';
import { supabase } from './lib/supabase.js';
import { whatsappSessionManager } from './lib/whatsapp.js';
import { sendError } from './utils/errors.js';
import {
    createPixSubscription,
    createCardSubscription
} from './lib/nexano.js';
import type {
    NexanoPixSubscriptionRequest,
    NexanoCardSubscriptionRequest
} from './lib/nexano.js';

dotenv.config();

// ==========================================
// CONFIGURAÇÃO DO SERVIDOR
// ==========================================

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

function parseAllowedOrigins(envValue: string | undefined): string[] {
    if (!envValue) return [];
    return envValue
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
}

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGINS);

const corsOptions: CorsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }

        if (!isProduction && allowedOrigins.length === 0) {
            callback(null, true);
            return;
        }

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Origin não permitida pelo CORS'));
    },
};

const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 100);

const apiLimiter = rateLimit({
    windowMs: Number.isFinite(rateLimitWindowMs) && rateLimitWindowMs > 0 ? rateLimitWindowMs : 15 * 60 * 1000,
    max: Number.isFinite(rateLimitMax) && rateLimitMax > 0 ? rateLimitMax : 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
        error: 'Muitas requisições',
        message: 'Você excedeu o limite de requisições. Tente novamente em instantes.',
    },
});

// Middlewares
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiLimiter);

// ==========================================
// TIPOS
// ==========================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ALLOWED_MESSAGE_STATUSES = ['AGUARDANDO', 'ENVIADA', 'ERRO'] as const;
type MessageStatus = (typeof ALLOWED_MESSAGE_STATUSES)[number];
type InternalPlan = 'STARTER' | 'PRO' | 'INACTIVE';

interface PlanView {
    id: string;
    name: string;
    status: 'active' | 'inactive';
    maxProcesses: number;
    supportLevel: string;
    description: string;
    monthlyPriceCents: number;
    currency: 'BRL';
    isCurrent?: boolean;
}

const PLAN_CATALOG: Record<InternalPlan, Omit<PlanView, 'isCurrent'> & { offerCode: string }> = {
    STARTER: {
        id: 'starter',
        name: 'Starter',
        status: 'active',
        maxProcesses: 10,
        supportLevel: 'suporte padrão',
        description: 'Plano inicial para escritório em operação. 7 dias grátis.',
        monthlyPriceCents: 9700,
        currency: 'BRL',
        offerCode: 'STARTER_97',
    },
    PRO: {
        id: 'pro',
        name: 'Pro',
        status: 'active',
        maxProcesses: 50,
        supportLevel: 'suporte prioritário',
        description: 'Plano para escritório em crescimento. 7 dias grátis.',
        monthlyPriceCents: 19700,
        currency: 'BRL',
        offerCode: 'PRO_197',
    },
    INACTIVE: {
        id: 'inactive',
        name: 'Inativo',
        status: 'inactive',
        maxProcesses: 0,
        supportLevel: 'nenhum',
        description: 'Assinatura necessária para utilizar o sistema.',
        monthlyPriceCents: 0,
        currency: 'BRL',
        offerCode: '',
    },
};

const PLAN_CURRENT_ROUTES: string[] = ['/api/planos/me', '/api/planos/atual', '/api/me/plano', '/api/assinatura'];
const PLAN_LIST_ROUTES: string[] = ['/api/planos', '/api/plans'];

const CNJ_DIGITS_LENGTH = 20;
const MAX_TONE_LENGTH = 80;
const PROCESS_TONES = ['EMPATICO', 'OBJETIVO', 'DESCONTRAIDO', 'FORMAL'] as const;
type ProcessTone = (typeof PROCESS_TONES)[number];
const CLIENT_LEGAL_ROLES = ['QUERELANTE', 'QUERELADO'] as const;
type ClientLegalRole = (typeof CLIENT_LEGAL_ROLES)[number];
const logLevel = (process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug')).toLowerCase() as LogLevel;

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

function shouldLog(level: LogLevel): boolean {
    const currentLevel = LOG_LEVEL_WEIGHT[logLevel] ? logLevel : 'info';
    return LOG_LEVEL_WEIGHT[level] >= LOG_LEVEL_WEIGHT[currentLevel];
}

function log(level: LogLevel, message: string, error?: unknown): void {
    if (!shouldLog(level)) return;

    const prefix = `[${level.toUpperCase()}]`;
    if (error && level === 'error') {
        const details = error instanceof Error ? error.message : String(error);
        console.error(`${prefix} ${message}${isProduction ? '' : ` | ${details}`}`);
        return;
    }

    if (level === 'warn') {
        console.warn(`${prefix} ${message}`);
        return;
    }

    console.log(`${prefix} ${message}`);
}

function normalizeAndValidateCNJ(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const digits = value.replace(/\D/g, '');
    if (digits.length !== CNJ_DIGITS_LENGTH) return null;

    return digits;
}

function formatCNJ(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== CNJ_DIGITS_LENGTH) return digits;

    return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16, 20)}`;
}

function parseTone(value: unknown, defaultTone: string): string | null {
    if (value === undefined || value === null || value === '') return defaultTone;
    if (typeof value !== 'string') return null;

    const trimmedTone = value.trim();
    if (!trimmedTone || trimmedTone.length > MAX_TONE_LENGTH) return null;

    return trimmedTone;
}

function normalizeToneText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function parseProcessTone(value: unknown): ProcessTone | null {
    if (value === undefined || value === null || value === '') return 'EMPATICO';
    if (typeof value !== 'string') return null;

    const trimmedTone = value.trim();
    if (!trimmedTone || trimmedTone.length > MAX_TONE_LENGTH) return null;

    const uppercaseTone = trimmedTone.toUpperCase();
    if ((PROCESS_TONES as readonly string[]).includes(uppercaseTone)) {
        return uppercaseTone as ProcessTone;
    }

    const normalized = normalizeToneText(trimmedTone);

    if (normalized.includes('empatic') || normalized.includes('tranquil') || normalized.includes('acolhed')) {
        return 'EMPATICO';
    }

    if (normalized.includes('objetiv') || normalized.includes('diret') || normalized.includes('claro')) {
        return 'OBJETIVO';
    }

    if (normalized.includes('descontra') || normalized.includes('casual') || normalized.includes('leve')) {
        return 'DESCONTRAIDO';
    }

    if (normalized.includes('formal') || normalized.includes('profission') || normalized.includes('tecnic')) {
        return 'FORMAL';
    }

    return null;
}

function parseClientLegalRole(value: unknown): ClientLegalRole | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') return null;

    const normalized = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();

    if (normalized === 'QUERELANTE') return 'QUERELANTE';
    if (normalized === 'QUERELADO' || normalized === 'ACUSADO') return 'QUERELADO';

    return null;
}

function maskCNJ(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 8) return 'CNJ-invalido';
    return `${digits.slice(0, 4)}********${digits.slice(-4)}`;
}

function isValidUuid(value: string): boolean {
    return /^[0-9a-fA-F-]{36}$/.test(value);
}

function methodNotAllowed(allowedMethods: string[]) {
    return (req: Request, res: Response): void => {
        if (allowedMethods.includes(req.method)) {
            return;
        }

        res.setHeader('Allow', allowedMethods.join(', '));
        sendError(
            res,
            405,
            'Método não permitido',
            `Método ${req.method} não suportado para esta rota. Use: ${allowedMethods.join(', ')}.`
        );
    };
}

function buildProcessLookupPayload(numeroCNJ: string, dadosProcesso: Awaited<ReturnType<typeof consultarProcesso>>) {
    return {
        numeroCNJ,
        numeroFormatado: formatCNJ(numeroCNJ),
        classe: dadosProcesso?.classe,
        dataUltimaAtualizacao: dadosProcesso?.dataUltimaAtualizacao,
        totalMovimentacoes: dadosProcesso?.movimentos?.length || 0,
        clientesSugeridos: dadosProcesso?.clientesSugeridos || [],
        partesEnvolvidas: (dadosProcesso?.partesEnvolvidas || []).map((parte) => ({
            nome: parte.nome,
            papel: parte.papel,
            lado: parte.lado,
        })),
    };
}

function normalizeComparableName(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function resolveClientPartyContext(clientName: string, parties: ProcessoParteEnvolvida[]): TranslationPartyContext | undefined {
    if (!clientName || parties.length === 0) return undefined;

    const target = normalizeComparableName(clientName);
    const matched = parties.find((party) => normalizeComparableName(party.nome) === target)
        || parties.find((party) => normalizeComparableName(party.nome).includes(target) || target.includes(normalizeComparableName(party.nome)));

    if (!matched) {
        return {
            clientName,
            clientRole: 'NAO_IDENTIFICADO',
            clientSide: 'INDEFINIDO',
        };
    }

    const counterpart = parties.find((party) => {
        if (party.nome === matched.nome && party.papel === matched.papel) return false;
        if (matched.lado === 'ATIVO') return party.lado === 'PASSIVO';
        if (matched.lado === 'PASSIVO') return party.lado === 'ATIVO';
        return true;
    });

    const context: TranslationPartyContext = {
        clientName: matched.nome,
        clientRole: matched.papel,
        clientSide: matched.lado,
    };

    if (counterpart?.nome) {
        context.counterpartName = counterpart.nome;
    }

    if (counterpart?.papel) {
        context.counterpartRole = counterpart.papel;
    }

    return context;
}

function buildExplicitRoleContext(clientName: string, role: ClientLegalRole): TranslationPartyContext {
    return {
        clientName,
        clientRole: role,
        clientSide: role === 'QUERELANTE' ? 'ATIVO' : 'PASSIVO',
    };
}

function normalizePlan(value: unknown): InternalPlan {
    if (value === 'STARTER' || value === 'PRO') return value;
    return 'INACTIVE';
}

async function fetchPlanContext(advogadoId: string): Promise<{ plan: InternalPlan; usedProcesses: number }> {
    const { data: advogado, error: advogadoError } = await supabase
        .from('Advogado')
        .select('plano')
        .eq('id', advogadoId)
        .single();

    if (advogadoError || !advogado) {
        throw new Error('ADVOGADO_NOT_FOUND');
    }

    const plan = normalizePlan(advogado.plano);

    const { count, error: processCountError } = await supabase
        .from('Processo')
        .select('*', { count: 'exact', head: true })
        .eq('advogadoId', advogadoId);

    if (processCountError) {
        throw new Error('PROCESS_COUNT_FAILED');
    }

    return {
        plan,
        usedProcesses: count || 0,
    };
}

// ==========================================
// ROTAS
// ==========================================

app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
});

/**
 * Rota de health check
 */
app.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'JurisZap Backend API',
    });
});

/**
 * Rota para consultar processo por número CNJ
 * GET /api/processos/:numero
 */
app.get('/api/processos/:numero([0-9.-]+)', async (req: Request, res: Response) => {
    try {
        const { numero: rawNumero } = req.params;
        const numeroCNJ = normalizeAndValidateCNJ(rawNumero);

        if (!numeroCNJ) {
            sendError(
                res,
                400,
                'Parâmetro inválido',
                'O parâmetro "numero" deve conter um CNJ válido com 20 dígitos.'
            );
            return;
        }

        log('info', `Consulta de processo recebida: ${maskCNJ(numeroCNJ)}`);

        const dadosProcesso = await consultarProcesso(numeroCNJ);

        if (!dadosProcesso) {
            sendError(
                res,
                404,
                'Processo não encontrado',
                `Não foram encontrados dados para o processo ${maskCNJ(numeroCNJ)}.`
            );
            return;
        }

        res.json({
            success: true,
            data: {
                ...dadosProcesso,
                numeroCNJ,
                numeroFormatado: formatCNJ(numeroCNJ),
                clientesSugeridos: dadosProcesso.clientesSugeridos || [],
                partesEnvolvidas: dadosProcesso.partesEnvolvidas || [],
            },
        });

    } catch (error) {
        log('error', 'Erro ao consultar processo por GET', error);
        sendError(
            res,
            500,
            'Erro na consulta',
            isProduction ? 'Falha ao consultar processo.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para consultar processo via POST (para números com caracteres especiais)
 * POST /api/processos
 * Body: { "numero": "0012345-67.2024.8.26.0100" }
 */
app.post('/api/processos', async (req: Request, res: Response) => {
    try {
        const { numero: rawNumero } = req.body;
        const numeroCNJ = normalizeAndValidateCNJ(rawNumero);

        if (!numeroCNJ) {
            sendError(
                res,
                400,
                'Parâmetro inválido',
                'O campo "numero" deve conter um CNJ válido com 20 dígitos.'
            );
            return;
        }

        log('info', `Consulta de processo via POST: ${maskCNJ(numeroCNJ)}`);

        const dadosProcesso = await consultarProcesso(numeroCNJ);

        if (!dadosProcesso) {
            sendError(
                res,
                404,
                'Processo não encontrado',
                `Não foram encontrados dados para o processo ${maskCNJ(numeroCNJ)}.`
            );
            return;
        }

        res.json({
            success: true,
            data: {
                ...dadosProcesso,
                numeroCNJ,
                numeroFormatado: formatCNJ(numeroCNJ),
                clientesSugeridos: dadosProcesso.clientesSugeridos || [],
                partesEnvolvidas: dadosProcesso.partesEnvolvidas || [],
            },
        });

    } catch (error) {
        log('error', 'Erro ao consultar processo por POST', error);
        sendError(
            res,
            500,
            'Erro na consulta',
            isProduction ? 'Falha ao consultar processo.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para busca do processo no fluxo de cadastro (botão "Buscar processo")
 * POST /api/processos/buscar
 * Body: { "numero": "0012345-67.2024.8.26.0100" }
 */
app.post('/api/processos/buscar', async (req: Request, res: Response) => {
    try {
        const { numero: rawNumero } = req.body;
        const numeroCNJ = normalizeAndValidateCNJ(rawNumero);

        if (!numeroCNJ) {
            sendError(
                res,
                400,
                'Parâmetro inválido',
                'O campo "numero" deve conter um CNJ válido com 20 dígitos.'
            );
            return;
        }

        const dadosProcesso = await consultarProcesso(numeroCNJ);

        if (!dadosProcesso) {
            sendError(
                res,
                404,
                'Processo não encontrado',
                `Não foram encontrados dados para o processo ${maskCNJ(numeroCNJ)}.`
            );
            return;
        }

        res.json({
            success: true,
            data: buildProcessLookupPayload(numeroCNJ, dadosProcesso),
        });
    } catch (error) {
        log('error', 'Erro ao buscar processo para cadastro', error);
        sendError(
            res,
            500,
            'Erro na consulta',
            isProduction ? 'Falha ao consultar processo.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para opções de formulário do processo
 * GET /api/processos/opcoes
 */
app.get('/api/processos/opcoes', (_req: Request, res: Response) => {
    res.json({
        success: true,
        data: {
            numeroProcesso: {
                digits: CNJ_DIGITS_LENGTH,
                mask: '9999999-99.9999.9.99.9999',
                example: '0012345-67.2024.8.26.0100',
            },
            tonsDisponiveis: PROCESS_TONES,
            tomPadrao: 'EMPATICO',
        },
    });
});

/**
 * Rota para consultar processo e traduzir a última movimentação com Gemini
 * GET /api/processos/:numero/traducao
 * Query params: ?tone=empático (opcional)
 */
app.get('/api/processos/:numero([0-9.-]+)/traducao', async (req: Request, res: Response) => {
    try {
        const { numero: rawNumero } = req.params;
        const numeroCNJ = normalizeAndValidateCNJ(rawNumero);
        const tone = parseTone(req.query.tone, 'empático e tranquilizador');
        const papelCliente = parseClientLegalRole(req.query.papelCliente);

        if (!numeroCNJ) {
            sendError(
                res,
                400,
                'Parâmetro inválido',
                'O parâmetro "numero" deve conter um CNJ válido com 20 dígitos.'
            );
            return;
        }

        if (!tone) {
            sendError(
                res,
                400,
                'Parâmetro inválido',
                `O parâmetro "tone" deve ser um texto com até ${MAX_TONE_LENGTH} caracteres.`
            );
            return;
        }

        log('info', `Consulta com tradução solicitada: ${maskCNJ(numeroCNJ)}`);

        // Busca os dados do processo no Datajud
        const dadosProcesso = await consultarProcesso(numeroCNJ);

        if (!dadosProcesso) {
            sendError(
                res,
                404,
                'Processo não encontrado',
                `Não foram encontrados dados para o processo ${maskCNJ(numeroCNJ)}.`
            );
            return;
        }

        // Verifica se há movimentações
        if (!dadosProcesso.movimentos || dadosProcesso.movimentos.length === 0) {
            sendError(res, 404, 'Sem movimentações', 'O processo não possui movimentações para traduzir.');
            return;
        }

        // Traduz a última movimentação usando Gemini
        const translationContext: TranslationPartyContext | undefined = papelCliente
            ? buildExplicitRoleContext('Cliente', papelCliente)
            : undefined;

        const traducao = await translateLatestMovement(
            dadosProcesso.movimentos as unknown as DatajudMovement[],
            dadosProcesso.classe || 'Não informada',
            tone,
            translationContext
        );

        res.json({
            success: true,
            processo: {
                classe: dadosProcesso.classe,
                dataUltimaAtualizacao: dadosProcesso.dataUltimaAtualizacao,
                totalMovimentacoes: dadosProcesso.movimentos.length,
            },
            traducao,
        });

    } catch (error) {
        log('error', 'Erro na rota de tradução de movimentação', error);
        sendError(
            res,
            500,
            'Erro na tradução',
            getGeminiFriendlyErrorMessage(error)
        );
    }
});

/**
 * Rota para retornar 5 últimas movimentações e traduzir apenas a mais recente
 * POST /api/processos/traducao-multipla
 * Body: { "numero": "xxx", "tone": "empático" }
 * Returns only the latest translation plus the last 5 raw movements
 */
app.post('/api/processos/traducao-multipla', async (req: Request, res: Response) => {
    try {
        const { numero: rawNumero, tone: rawTone = 'empático e tranquilizador', papelCliente: rawPapelCliente } = req.body;
        const numeroCNJ = normalizeAndValidateCNJ(rawNumero);
        const tone = parseTone(rawTone, 'empático e tranquilizador');
        const papelCliente = parseClientLegalRole(rawPapelCliente);

        if (!numeroCNJ) {
            sendError(
                res,
                400,
                'Parâmetro inválido',
                'O campo "numero" deve conter um CNJ válido com 20 dígitos.'
            );
            return;
        }

        if (!tone) {
            sendError(
                res,
                400,
                'Parâmetro inválido',
                `O campo "tone" deve ser um texto com até ${MAX_TONE_LENGTH} caracteres.`
            );
            return;
        }

        log('info', `Consulta de últimas movimentações solicitada para ${maskCNJ(numeroCNJ)}`);

        // Busca os dados do processo no Datajud
        const dadosProcesso = await consultarProcesso(numeroCNJ);

        if (!dadosProcesso) {
            sendError(
                res,
                404,
                'Processo não encontrado',
                `Não foram encontrados dados para o processo ${maskCNJ(numeroCNJ)}.`
            );
            return;
        }

        // Verifica se há movimentações
        if (!dadosProcesso.movimentos || dadosProcesso.movimentos.length === 0) {
            sendError(res, 404, 'Sem movimentações', 'O processo não possui movimentações para traduzir.');
            return;
        }

        const sortedMovements = [...(dadosProcesso.movimentos as unknown as DatajudMovement[])].sort((a, b) => {
            const dateA = new Date(a.dataHora || 0).getTime();
            const dateB = new Date(b.dataHora || 0).getTime();
            return dateB - dateA;
        });

        const ultimasMovimentacoes = sortedMovements.slice(0, 5);
        const ultimaMovimentacao = ultimasMovimentacoes[0];

        if (!ultimaMovimentacao) {
            sendError(res, 404, 'Sem movimentações', 'O processo não possui movimentações válidas para tradução.');
            return;
        }

        // Traduz somente a movimentação mais recente para reduzir custo e latência
        const translationContext: TranslationPartyContext | undefined = papelCliente
            ? buildExplicitRoleContext('Cliente', papelCliente)
            : undefined;

        const traducaoUltima = await translateLatestMovement(
            [ultimaMovimentacao],
            dadosProcesso.classe || 'Não informada',
            tone,
            translationContext
        );

        res.json({
            success: true,
            processo: {
                classe: dadosProcesso.classe,
                dataUltimaAtualizacao: dadosProcesso.dataUltimaAtualizacao,
                totalMovimentacoes: dadosProcesso.movimentos.length,
            },
            traducaoUltima,
            traducoes: [traducaoUltima],
            ultimasMovimentacoes,
            count: ultimasMovimentacoes.length,
        });

    } catch (error) {
        log('error', 'Erro na rota de tradução múltipla', error);
        sendError(
            res,
            500,
            'Erro na tradução',
            getGeminiFriendlyErrorMessage(error)
        );
    }
});

// ==========================================
// ROTAS PROTEGIDAS (REQUEREM AUTENTICAÇÃO)
// ==========================================

/**
 * Rota para salvar um processo do advogado (PROTEGIDA)
 * POST /api/meus-processos/salvar
 * Body: { numeroCNJ, nomeCliente, telefoneCliente, tomDeVoz? }
 * 
 * Fluxo completo:
 * 1. Verifica limite do plano
 * 2. Verifica/cria o cliente
 * 3. Salva o processo
 * 4. Consulta Datajud e traduz última movimentação
 * 5. Salva primeira mensagem traduzida
 */
app.post('/api/meus-processos/salvar', requireAuth, checkProcessLimit, async (req: Request, res: Response) => {
    try {
        const { numeroCNJ, nomeCliente, telefoneCliente, tomDeVoz, papelCliente: rawPapelCliente } = req.body;
        const advogadoId = req.user!.id;
        const numeroCNJNormalizado = normalizeAndValidateCNJ(numeroCNJ);
        const tomDeVozNormalizado = parseProcessTone(tomDeVoz);
        const papelCliente = parseClientLegalRole(rawPapelCliente);
        const nomeClienteNormalizado = typeof nomeCliente === 'string' ? nomeCliente.trim() : '';

        // Validação dos campos obrigatórios
        if (!numeroCNJNormalizado || !nomeClienteNormalizado || !telefoneCliente) {
            sendError(
                res,
                400,
                'Parâmetros inválidos',
                'Os campos "numeroCNJ" (CNJ válido), "nomeCliente" e "telefoneCliente" são obrigatórios.'
            );
            return;
        }

        if (!tomDeVozNormalizado) {
            sendError(
                res,
                400,
                'Tom de voz inválido',
                'Use um tom válido como "EMPATICO", "OBJETIVO", "DESCONTRAIDO" ou "FORMAL".'
            );
            return;
        }

        if (rawPapelCliente !== undefined && !papelCliente) {
            sendError(
                res,
                400,
                'Papel do cliente inválido',
                `Use "papelCliente" com um destes valores: ${CLIENT_LEGAL_ROLES.join(', ')}.`
            );
            return;
        }

        log('info', `Iniciando salvamento do processo ${maskCNJ(numeroCNJNormalizado)}`);

        // ==========================================
        // STEP A: VERIFICAR/CRIAR CLIENTE
        // ==========================================

        log('debug', 'Verificando existência de cliente por telefone');

        let clienteId: string;
        let nomeClientePersistido = nomeClienteNormalizado;

        // Busca cliente existente pelo telefone e advogado
        const { data: clienteExistente } = await supabase
            .from('Cliente')
            .select('id, nome, telefone')
            .eq('telefone', telefoneCliente)
            .eq('advogadoId', advogadoId)
            .single();

        if (clienteExistente) {
            clienteId = clienteExistente.id;
            nomeClientePersistido = clienteExistente.nome;
            console.log(`✅ Cliente já existe: ${clienteId}`);

            if (clienteExistente.nome !== nomeClienteNormalizado) {
                const { data: clienteAtualizado, error: updateClienteError } = await supabase
                    .from('Cliente')
                    .update({ nome: nomeClienteNormalizado })
                    .eq('id', clienteId)
                    .eq('advogadoId', advogadoId)
                    .select('id, nome')
                    .single();

                if (updateClienteError) {
                    log('error', 'Erro ao atualizar nome do cliente existente', updateClienteError);
                    sendError(
                        res,
                        500,
                        'Erro ao atualizar cliente',
                        isProduction ? 'Falha ao atualizar dados do cliente.' : updateClienteError.message
                    );
                    return;
                }

                if (clienteAtualizado?.nome) {
                    nomeClientePersistido = clienteAtualizado.nome;
                }
            }
        } else {
            // Cria novo cliente
            console.log(`➕ Criando novo cliente...`);
            const { data: novoCliente, error: clienteError } = await supabase
                .from('Cliente')
                .insert({
                    nome: nomeClienteNormalizado,
                    telefone: telefoneCliente,
                    advogadoId,
                })
                .select()
                .single();

            if (clienteError || !novoCliente) {
                log('error', 'Erro ao criar cliente', clienteError);
                sendError(
                    res,
                    500,
                    'Erro ao criar cliente',
                    isProduction ? 'Falha ao criar cliente.' : clienteError?.message || 'Erro desconhecido.'
                );
                return;
            }

            clienteId = novoCliente.id;
            nomeClientePersistido = novoCliente.nome;
            console.log(`✅ Novo cliente criado: ${clienteId}`);
        }

        // ==========================================
        // STEP B: SALVAR PROCESSO
        // ==========================================

        log('debug', 'Verificando duplicidade de processo para o advogado');

        // Verifica se o processo já existe para este advogado
        const { data: processoExistente } = await supabase
            .from('Processo')
            .select('id, numeroCNJ')
            .eq('numeroCNJ', numeroCNJNormalizado)
            .eq('advogadoId', advogadoId)
            .single();

        if (processoExistente) {
            sendError(
                res,
                409,
                'Processo já existe',
                `O processo ${maskCNJ(numeroCNJNormalizado)} já está cadastrado para você.`
            );
            return;
        }

        log('info', `Consultando Datajud para ${maskCNJ(numeroCNJNormalizado)}`);

        // Consulta o Datajud para obter a classe do processo
        const dadosDatajud = await consultarProcesso(numeroCNJNormalizado);

        if (!dadosDatajud) {
            sendError(
                res,
                404,
                'Processo não encontrado no Datajud',
                `Não foi possível encontrar o processo ${maskCNJ(numeroCNJNormalizado)} no Datajud.`
            );
            return;
        }

        console.log(`✅ Dados obtidos do Datajud. Classe: ${dadosDatajud.classe}`);

        // Cria o processo no banco
        const { data: novoProcesso, error: processoError } = await supabase
            .from('Processo')
            .insert({
                numeroCNJ: numeroCNJNormalizado,
                classe: dadosDatajud.classe || 'Não informada',
                tomDeVoz: tomDeVozNormalizado,
                advogadoId,
                clienteId,
            })
            .select()
            .single();

        if (processoError || !novoProcesso) {
            log('error', 'Erro ao salvar processo', processoError);
            sendError(
                res,
                500,
                'Erro ao salvar processo',
                isProduction ? 'Falha ao salvar processo.' : processoError?.message || 'Erro desconhecido.'
            );
            return;
        }

        console.log(`✅ Processo salvo com sucesso: ${novoProcesso.id}`);

        // ==========================================
        // STEP C & D: TRADUZIR E SALVAR PRIMEIRA MENSAGEM
        // ==========================================

        let primeiraMensagem = null;

        // Verifica se há movimentações para traduzir
        if (dadosDatajud.movimentos && dadosDatajud.movimentos.length > 0) {
            console.log(`🤖 Traduzindo última movimentação com Gemini...`);

            try {
                const contextoPartes = papelCliente
                    ? buildExplicitRoleContext(nomeClientePersistido, papelCliente)
                    : resolveClientPartyContext(nomeClientePersistido, dadosDatajud.partesEnvolvidas || []);

                // Traduz a última movimentação
                const traducao = await translateLatestMovement(
                    dadosDatajud.movimentos as unknown as DatajudMovement[],
                    dadosDatajud.classe || 'Não informada',
                    tomDeVozNormalizado,
                    contextoPartes
                );

                console.log(`✅ Tradução concluída`);

                // Pega a movimentação mais recente para obter os dados técnicos
                const movimentacoes = dadosDatajud.movimentos as unknown as DatajudMovement[];
                const ultimaMovimentacao = movimentacoes.sort((a, b) => {
                    const dateA = new Date(a.dataHora || 0).getTime();
                    const dateB = new Date(b.dataHora || 0).getTime();
                    return dateB - dateA;
                })[0];

                const textoTecnico = `${ultimaMovimentacao?.nome || 'Movimentação'}${
                    ultimaMovimentacao?.complementosTabelados?.[0]?.nome 
                        ? ` - ${ultimaMovimentacao.complementosTabelados[0].nome}` 
                        : ''
                }`;

                // Salva a mensagem traduzida no banco
                console.log(`💾 Salvando mensagem traduzida...`);

                const { data: mensagem, error: mensagemError } = await supabase
                    .from('Mensagem')
                    .insert({
                        dataMovimentacao: ultimaMovimentacao?.dataHora || new Date().toISOString(),
                        textoTecnico,
                        textoTraduzido: traducao.whatsapp_message,
                        status: 'AGUARDANDO',
                        processoId: novoProcesso.id,
                    })
                    .select()
                    .single();

                if (mensagemError) {
                    log('warn', 'Erro ao salvar mensagem traduzida inicial');
                } else {
                    primeiraMensagem = {
                        ...mensagem,
                        traducao: {
                            is_relevant_for_client: traducao.is_relevant_for_client,
                            requires_lawyer_action: traducao.requires_lawyer_action,
                            lawyer_summary: traducao.lawyer_summary,
                        },
                        contextoPartes,
                    };
                    console.log(`✅ Mensagem salva: ${mensagem?.id}`);
                }

            } catch (traducaoError) {
                log('warn', 'Erro ao traduzir movimentação inicial');
                // Continua mesmo se a tradução falhar
            }
        } else {
            log('info', 'Processo sem movimentações para traduzir');
        }

        // ==========================================
        // RESPOSTA FINAL
        // ==========================================

        log('info', `Processo salvo com sucesso: ${maskCNJ(numeroCNJNormalizado)}`);

        res.status(201).json({
            success: true,
            data: {
                processo: {
                    ...novoProcesso,
                    totalMovimentacoes: dadosDatajud.movimentos?.length || 0,
                    dataUltimaAtualizacao: dadosDatajud.dataUltimaAtualizacao,
                },
                cliente: {
                    id: clienteId,
                    nome: nomeClientePersistido,
                    telefone: telefoneCliente,
                },
                primeiraMensagem,
            },
        });

    } catch (error) {
        log('error', 'Erro ao processar salvamento de processo', error);
        sendError(
            res,
            500,
            'Erro interno',
            isProduction ? 'Erro ao processar a requisição.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para obter dashboard do advogado (PROTEGIDA)
 * GET /api/dashboard
 */
app.get('/api/dashboard', requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;

        // Busca estatísticas do advogado
        const { data: processos, error: processosError } = await supabase
            .from('Processo')
            .select('id')
            .eq('advogadoId', advogadoId);

        if (processosError) {
            throw processosError;
        }

        const { data: clientes, error: clientesError } = await supabase
            .from('Cliente')
            .select('id')
            .eq('advogadoId', advogadoId);

        if (clientesError) {
            throw clientesError;
        }

        const processosIds = processos?.map(p => p.id) || [];
        let mensagens: Array<{ id: string; status: string; processoId: string }> = [];

        if (processosIds.length > 0) {
            const { data: mensagensData, error: mensagensError } = await supabase
                .from('Mensagem')
                .select('id, status, processoId')
                .in('processoId', processosIds);

            if (mensagensError) {
                throw mensagensError;
            }

            mensagens = mensagensData || [];
        }

        // Calcula estatísticas
        const totalProcessos = processos?.length || 0;
        const totalClientes = clientes?.length || 0;
        const totalMensagens = mensagens?.length || 0;
        const mensagensAguardando = mensagens?.filter(m => m.status === 'AGUARDANDO').length || 0;
        const mensagensEnviadas = mensagens?.filter(m => m.status === 'ENVIADA').length || 0;

        res.json({
            success: true,
            dashboard: {
                totalProcessos,
                totalClientes,
                totalMensagens,
                mensagensAguardando,
                mensagensEnviadas,
            },
        });

    } catch (error) {
        log('error', 'Erro ao buscar dashboard', error);
        sendError(
            res,
            500,
            'Erro ao buscar dashboard',
            isProduction ? 'Falha ao buscar dashboard.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rotas de plano atual do advogado (PROTEGIDAS)
 * GET /api/planos/me
 * GET /api/planos/atual
 * GET /api/me/plano
 * GET /api/assinatura
 */
app.get(PLAN_CURRENT_ROUTES, requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;
        const { plan, usedProcesses } = await fetchPlanContext(advogadoId);
        const plano: PlanView = {
            ...PLAN_CATALOG[plan],
            isCurrent: true,
        };
        const uso = {
            usedProcesses,
        };

        res.json({
            success: true,
            data: {
                plano,
                uso,
            },
            plano,
            uso,
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'ADVOGADO_NOT_FOUND') {
            sendError(res, 404, 'Assinatura não encontrada', 'Advogado não encontrado para a sessão atual.');
            return;
        }

        log('error', 'Erro ao buscar plano atual', error);
        sendError(
            res,
            500,
            'Erro ao buscar plano',
            isProduction ? 'Falha ao buscar dados do plano.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rotas de listagem de planos (PROTEGIDAS)
 * GET /api/planos
 * GET /api/plans
 */
app.get(PLAN_LIST_ROUTES, requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;
        const { plan: currentPlan } = await fetchPlanContext(advogadoId);

        const planos: PlanView[] = (Object.keys(PLAN_CATALOG) as InternalPlan[])
            .filter(key => key !== 'INACTIVE')
            .map((planKey) => ({
                ...PLAN_CATALOG[planKey],
                isCurrent: planKey === currentPlan,
            }));

        res.json({
            success: true,
            data: {
                planos,
            },
            planos,
        });
    } catch (error) {
        if (error instanceof Error && error.message === 'ADVOGADO_NOT_FOUND') {
            sendError(res, 404, 'Assinatura não encontrada', 'Advogado não encontrado para a sessão atual.');
            return;
        }

        log('error', 'Erro ao listar planos', error);
        sendError(
            res,
            500,
            'Erro ao listar planos',
            isProduction ? 'Falha ao listar planos.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para listar processos do advogado (PROTEGIDA)
 * GET /api/meus-processos
 */
app.get('/api/meus-processos', requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;
        const limit = Number(req.query.limit ?? 50);
        const offset = Number(req.query.offset ?? 0);

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            sendError(res, 400, 'Parâmetro inválido', 'O parâmetro "limit" deve ser um inteiro entre 1 e 100.');
            return;
        }

        if (!Number.isInteger(offset) || offset < 0) {
            sendError(res, 400, 'Parâmetro inválido', 'O parâmetro "offset" deve ser um inteiro maior ou igual a 0.');
            return;
        }

        const { data, error, count } = await supabase
            .from('Processo')
            .select(`
                id,
                numeroCNJ,
                classe,
                tomDeVoz,
                createdAt,
                Cliente (
                    id,
                    nome,
                    telefone
                )
            `, { count: 'exact' })
            .eq('advogadoId', advogadoId)
            .order('createdAt', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            log('error', 'Erro ao buscar processos', error);
            sendError(
                res,
                500,
                'Erro ao buscar processos',
                isProduction ? 'Falha ao buscar processos.' : error.message
            );
            return;
        }

        res.json({
            success: true,
            data,
            pagination: {
                total: count || 0,
                limit,
                offset,
            },
        });

    } catch (error) {
        log('error', 'Erro ao listar processos', error);
        sendError(
            res,
            500,
            'Erro interno',
            isProduction ? 'Erro ao processar a requisição.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para listar mensagens salvas de um processo do advogado (PROTEGIDA)
 * GET /api/meus-processos/:id/mensagens
 */
app.get('/api/meus-processos/:id/mensagens', requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;
        const { id } = req.params;
        const limit = Number(req.query.limit ?? 5);

        if (!id || !isValidUuid(id)) {
            sendError(res, 400, 'Parâmetro inválido', 'O parâmetro "id" deve ser um UUID válido.');
            return;
        }

        if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            sendError(res, 400, 'Parâmetro inválido', 'O parâmetro "limit" deve ser um inteiro entre 1 e 50.');
            return;
        }

        const { data: processo, error: processoError } = await supabase
            .from('Processo')
            .select('id, numeroCNJ')
            .eq('id', id)
            .eq('advogadoId', advogadoId)
            .single();

        if (processoError || !processo) {
            sendError(res, 404, 'Processo não encontrado', 'O processo não existe ou você não tem permissão para acessá-lo.');
            return;
        }

        const { data: mensagens, error: mensagensError } = await supabase
            .from('Mensagem')
            .select('id, processoId, dataMovimentacao, textoTecnico, textoTraduzido, status')
            .eq('processoId', processo.id)
            .order('dataMovimentacao', { ascending: false })
            .limit(limit);

        if (mensagensError) {
            log('error', 'Erro ao listar mensagens do processo', mensagensError);
            sendError(
                res,
                500,
                'Erro ao listar mensagens',
                isProduction ? 'Falha ao listar mensagens do processo.' : mensagensError.message
            );
            return;
        }

        res.json({
            success: true,
            processo: {
                id: processo.id,
                numeroCNJ: processo.numeroCNJ,
            },
            mensagens: mensagens || [],
            count: mensagens?.length || 0,
        });
    } catch (error) {
        log('error', 'Erro ao listar mensagens do processo', error);
        sendError(
            res,
            500,
            'Erro interno',
            isProduction ? 'Erro ao processar a requisição.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para excluir um processo do advogado (PROTEGIDA)
 * DELETE /api/meus-processos/:id
 */
app.delete('/api/meus-processos/:id', requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;
        const { id } = req.params;

        if (!id || !/^[0-9a-fA-F-]{36}$/.test(id)) {
            sendError(res, 400, 'Parâmetro inválido', 'O parâmetro "id" deve ser um UUID válido.');
            return;
        }

        const { data: processo, error: processoError } = await supabase
            .from('Processo')
            .select('id, numeroCNJ')
            .eq('id', id)
            .eq('advogadoId', advogadoId)
            .single();

        if (processoError || !processo) {
            sendError(res, 404, 'Processo não encontrado', 'O processo não existe ou você não tem permissão para excluí-lo.');
            return;
        }

        const { error: deleteError } = await supabase
            .from('Processo')
            .delete()
            .eq('id', id)
            .eq('advogadoId', advogadoId);

        if (deleteError) {
            log('error', 'Erro ao excluir processo', deleteError);
            sendError(
                res,
                500,
                'Erro ao excluir processo',
                isProduction ? 'Falha ao excluir processo.' : deleteError.message
            );
            return;
        }

        res.json({
            success: true,
            data: {
                id: processo.id,
                numeroCNJ: processo.numeroCNJ,
                deleted: true,
            },
            message: 'Processo excluído com sucesso.',
        });
    } catch (error) {
        log('error', 'Erro ao excluir processo', error);
        sendError(
            res,
            500,
            'Erro interno',
            isProduction ? 'Erro ao processar a requisição.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para aprovar/editar uma mensagem antes de enviar (PROTEGIDA)
 * PUT /api/mensagens/:id/aprovar
 * Body: { textoTraduzido?, status? }
 */
app.put('/api/mensagens/:id/aprovar', requireAuth, async (req: Request, res: Response) => {
    // ... code for approving messages ...
});

// ==========================================
// PAGAMENTOS E ASSINATURAS (NEXANO)
// ==========================================

/**
 * Cria uma assinatura via Pix ou Cartão na Nexano
 */
app.post('/api/assinaturas/checkouts', requireAuth, async (req: Request, res: Response) => {
    const { planId, paymentMethod, cardInfo, clientIp } = req.body;
    const authId = req.user?.id;

    if (!authId) return sendError(res, 401, 'Não autorizado', 'Usuário não autenticado.');

    const internalPlanKey = Object.keys(PLAN_CATALOG).find(
        key => PLAN_CATALOG[key as InternalPlan].id === planId
    ) as InternalPlan;

    if (!internalPlanKey) {
        return sendError(res, 400, 'Plano inválido', 'O plano selecionado não existe no catálogo.');
    }

    const plan = PLAN_CATALOG[internalPlanKey];

    // Busca dados do advogado para pré-preencher a Nexano
    const { data: advogado, error: advError } = await supabase
        .from('Advogado')
        .select('*')
        .eq('id', authId)
        .single();

    if (advError || !advogado) {
        return sendError(res, 404, 'Advogado não encontrado', 'Os dados do advogado não foram encontrados.');
    }

    try {
        const identifier = `${authId}_${Date.now()}`;
        const commonData = {
            identifier,
            amount: plan.monthlyPriceCents / 100,
            client: {
                name: req.body.client?.name || advogado.nome,
                email: req.body.client?.email || advogado.email,
                phone: req.body.client?.phone || advogado.telefone || '(00) 00000-0000',
                document: req.body.client?.document || advogado.cpf || '000.000.000-00',
            },
            product: {
                id: plan.id,
                name: `JurisZap - Plano ${plan.name}`,
                quantity: 1,
                price: plan.monthlyPriceCents / 100,
            },
            subscription: {
                periodicityType: 'MONTHS' as const,
                periodicity: 1,
                firstChargeIn: 7, // 7 dias gratuitos (Trial)
            },
            metadata: {
                userId: authId,
                planKey: internalPlanKey,
            },
            callbackUrl: `${process.env.OPENROUTER_SITE_URL}/api/webhooks/nexano`,
        };

        if (paymentMethod === 'PIX') {
            const result = await createPixSubscription(commonData as NexanoPixSubscriptionRequest);
            return res.status(201).json(result);
        } else if (paymentMethod === 'CARD') {
            if (!cardInfo || !clientIp) {
                return sendError(res, 400, 'Dados do cartão ausentes', 'Por favor, forneça as informações do cartão.');
            }
            const cardData: NexanoCardSubscriptionRequest = {
                ...commonData,
                clientIp,
                client: {
                    ...commonData.client,
                    address: cardInfo.address, // Endereço de cobrança
                },
                card: cardInfo.card,
            };
            const result = await createCardSubscription(cardData);
            return res.status(201).json(result);
        }

        return sendError(res, 400, 'Método de pagamento inválido', 'Os métodos aceitos são PIX e CARD.');
    } catch (error: any) {
        log('error', 'Erro ao criar assinatura na Nexano', error);
        return sendError(res, 500, 'Erro no checkout', error.response?.data?.message || error.message);
    }
});

/**
 * Webhook para receber confirmações de pagamento da Nexano
 */
app.post('/api/webhooks/nexano', async (req: Request, res: Response) => {
    const { event, token, metadata, offerCode, subscription } = req.body;

    // Verificação de segurança (Token Webhook)
    if (token !== process.env.NEXANO_WEBHOOK_TOKEN) {
        log('warn', 'Tentativa de webhook não autorizado (token inválido)');
        return res.status(401).json({ error: 'Unauthorized' });
    }

    log('info', `Webhook Nexano recebido: ${event}`);

    try {
        const userId = metadata?.userId || req.body.client?.id; // Tenta pegar pelo metadata primeiro
        
        if (!userId) {
            log('error', 'Webhook sem userId no metadata');
            return res.status(400).json({ error: 'Missing userId' });
        }

        if (event === 'TRANSACTION_PAID') {
            // Mapeia o offerCode de volta para nosso plano interno
            const planKey = Object.keys(PLAN_CATALOG).find(
                key => PLAN_CATALOG[key as InternalPlan].offerCode === offerCode
            ) as InternalPlan;

            if (planKey) {
                log('info', `Atualizando plano do usuário ${userId} para ${planKey}`);
                
                const { error: updateError } = await supabase
                    .from('Advogado')
                    .update({ plano: planKey, updatedAt: new Date().toISOString() })
                    .eq('id', userId);

                if (updateError) {
                    log('error', `Erro ao atualizar plano no Supabase: ${updateError.message}`);
                    return res.status(500).json({ error: 'Internal update failed' });
                }
            }
        } else if (event === 'SUBSCRIPTION_CANCELED') {
            log('info', `Assinatura cancelada para usuário ${userId}. Movendo para INACTIVE.`);
            
            await supabase
                .from('Advogado')
                .update({ plano: 'INACTIVE', updatedAt: new Date().toISOString() })
                .eq('id', userId);
        }

        return res.status(200).json({ received: true });
    } catch (error) {
        log('error', 'Erro ao processar webhook Nexano', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/mensagens/:id/aprovar', requireAuth, async (req: Request, res: Response) => {
    try {

        const { id } = req.params;
        const { textoTraduzido, textoEditado, status } = req.body;
        const advogadoId = req.user!.id;

        if (!id) {
            sendError(res, 400, 'Parâmetro inválido', 'ID da mensagem é obrigatório.');
            return;
        }

        if (!isValidUuid(id)) {
            sendError(res, 400, 'Parâmetro inválido', 'ID da mensagem deve ser um UUID válido.');
            return;
        }

        const normalizedText =
            typeof textoTraduzido === 'string'
                ? textoTraduzido.trim()
                : typeof textoEditado === 'string'
                    ? textoEditado.trim()
                    : undefined;

        if (normalizedText === '' || (status !== undefined && typeof status !== 'string')) {
            sendError(
                res,
                400,
                'Parâmetros inválidos',
                'Campos inválidos. "textoTraduzido"/"textoEditado" devem ser texto e "status" deve ser string.'
            );
            return;
        }

        if (status !== undefined && !ALLOWED_MESSAGE_STATUSES.includes(status as MessageStatus)) {
            sendError(res, 400, 'Status inválido', `Status permitido: ${ALLOWED_MESSAGE_STATUSES.join(', ')}`);
            return;
        }

        if (normalizedText === undefined && status === undefined) {
            sendError(
                res,
                400,
                'Parâmetros inválidos',
                'Informe ao menos um campo para atualização: "textoTraduzido"/"textoEditado" ou "status".'
            );
            return;
        }

        // Verifica se a mensagem pertence a um processo do advogado
        const { data: mensagem, error: fetchError } = await supabase
            .from('Mensagem')
            .select(`
                id,
                processoId,
                Processo!inner (
                    advogadoId
                )
            `)
            .eq('id', id)
            .single();

        if (fetchError || !mensagem) {
            sendError(res, 404, 'Mensagem não encontrada', 'A mensagem não existe ou você não tem permissão para acessá-la.');
            return;
        }

        // Verifica se o advogado é o dono do processo
        const processo = mensagem.Processo as unknown as { advogadoId: string };
        if (processo.advogadoId !== advogadoId) {
            sendError(res, 403, 'Acesso negado', 'Você não tem permissão para editar esta mensagem.');
            return;
        }

        // Atualiza a mensagem
        const updateData: Record<string, unknown> = {};
        if (normalizedText !== undefined) updateData.textoTraduzido = normalizedText;
        if (status !== undefined) updateData.status = status;

        const { data, error: updateError } = await supabase
            .from('Mensagem')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (updateError) {
            log('error', 'Erro ao atualizar mensagem', updateError);
            sendError(
                res,
                500,
                'Erro ao atualizar',
                isProduction ? 'Falha ao atualizar mensagem.' : updateError.message
            );
            return;
        }

        log('info', 'Mensagem atualizada com sucesso');

        res.json({
            success: true,
            data,
        });

    } catch (error) {
        log('error', 'Erro ao aprovar/editar mensagem', error);
        sendError(
            res,
            500,
            'Erro interno',
            isProduction ? 'Erro ao processar a requisição.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para enviar uma mensagem ao cliente via WhatsApp (PROTEGIDA)
 * POST /api/mensagens/:id/enviar
 */
app.post('/api/mensagens/:id/enviar', requireAuth, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const advogadoId = req.user!.id;

        if (!id) {
            sendError(res, 400, 'Parâmetro inválido', 'ID da mensagem é obrigatório.');
            return;
        }

        if (!isValidUuid(id)) {
            sendError(res, 400, 'Parâmetro inválido', 'ID da mensagem deve ser um UUID válido.');
            return;
        }

        const waStatus = whatsappSessionManager.getStatus(advogadoId);
        if (waStatus.status !== 'connected') {
            sendError(
                res,
                503,
                'WhatsApp desconectado',
                'Conecte seu WhatsApp antes de enviar mensagens ao cliente.'
            );
            return;
        }

        const { data: mensagem, error: fetchError } = await supabase
            .from('Mensagem')
            .select(`
                id,
                textoTraduzido,
                status,
                processoId,
                Processo!inner (
                    advogadoId,
                    Cliente!inner (
                        id,
                        telefone
                    )
                )
            `)
            .eq('id', id)
            .single();

        if (fetchError || !mensagem) {
            sendError(res, 404, 'Mensagem não encontrada', 'A mensagem não existe ou você não tem permissão para acessá-la.');
            return;
        }

        const processo = mensagem.Processo as unknown as {
            advogadoId: string;
            Cliente?: {
                id: string;
                telefone: string;
            } | {
                id: string;
                telefone: string;
            }[];
        };

        if (processo.advogadoId !== advogadoId) {
            sendError(res, 403, 'Acesso negado', 'Você não tem permissão para enviar esta mensagem.');
            return;
        }

        const clienteData = Array.isArray(processo.Cliente) ? processo.Cliente[0] : processo.Cliente;
        const telefoneCliente = clienteData?.telefone;

        if (!telefoneCliente) {
            sendError(res, 422, 'Telefone ausente', 'O cliente não possui telefone cadastrado para envio via WhatsApp.');
            return;
        }

        const texto = typeof mensagem.textoTraduzido === 'string' ? mensagem.textoTraduzido.trim() : '';

        if (!texto) {
            sendError(res, 422, 'Mensagem vazia', 'A mensagem não possui texto para envio.');
            return;
        }

        const sendResult = await whatsappSessionManager.sendTextMessage(advogadoId, telefoneCliente, texto);

        const { data: updatedMessage, error: updateError } = await supabase
            .from('Mensagem')
            .update({ status: 'ENVIADA' })
            .eq('id', id)
            .select()
            .single();

        if (updateError) {
            log('error', 'Mensagem enviada, mas falhou ao atualizar status no banco', updateError);
            sendError(
                res,
                500,
                'Erro ao atualizar status',
                isProduction ? 'Mensagem enviada, mas falhou ao registrar status no banco.' : updateError.message
            );
            return;
        }

        res.json({
            success: true,
            data: {
                mensagem: updatedMessage,
                envio: {
                    messageId: sendResult.messageId,
                    recipientJid: sendResult.recipientJid,
                    sentAt: new Date().toISOString(),
                },
            },
        });
    } catch (error) {
        log('error', 'Erro ao enviar mensagem no WhatsApp', error);
        sendError(
            res,
            500,
            'Erro ao enviar mensagem',
            isProduction ? 'Falha ao enviar mensagem no WhatsApp.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para obter status da conexão WhatsApp (PROTEGIDA)
 * GET /api/whatsapp/status
 */
app.get('/api/whatsapp/status', requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;
        const status = whatsappSessionManager.getStatus(advogadoId);

        res.json({
            success: true,
            data: status,
        });
    } catch (error) {
        log('error', 'Erro ao buscar status do WhatsApp', error);
        sendError(
            res,
            500,
            'Erro ao buscar status',
            isProduction ? 'Falha ao consultar status do WhatsApp.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

/**
 * Rota para iniciar conexão WhatsApp (PROTEGIDA)
 * POST /api/whatsapp/conectar
 * Body: { mode?: 'qr' | 'pairing', phoneNumber?: string, forceNewSession?: boolean }
 */
app.post('/api/whatsapp/conectar', requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;
        const mode = req.body?.mode === 'pairing' ? 'pairing' : 'qr';
        const phoneNumber = typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber : undefined;
        const forceNewSession = req.body?.forceNewSession === true;

        if (mode === 'pairing' && !phoneNumber) {
            sendError(
                res,
                400,
                'Parâmetro inválido',
                'O campo "phoneNumber" é obrigatório quando "mode" for "pairing".'
            );
            return;
        }

        const connection = await whatsappSessionManager.connect(advogadoId, { mode, phoneNumber, forceNewSession });

        res.json({
            success: true,
            data: connection,
        });
    } catch (error) {
        log('error', 'Erro ao iniciar conexão WhatsApp', error);

        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido.';
        const friendlyMessage = errorMessage.includes('Connection Closed')
            ? 'Conexão com WhatsApp encerrada durante a tentativa. Tente novamente em alguns segundos ou use o modo QR.'
            : errorMessage.includes('pareamento') || errorMessage.includes('pairing')
                ? 'Falha ao gerar código de conexão. Confirme o telefone no formato DDI+DDD+número (ex: 5585999999999) e tente novamente.'
            : isProduction
                ? 'Falha ao iniciar conexão do WhatsApp.'
                : errorMessage;

        sendError(
            res,
            500,
            'Erro ao conectar WhatsApp',
            friendlyMessage
        );
    }
});

/**
 * Rota para desconectar WhatsApp (PROTEGIDA)
 * POST /api/whatsapp/desconectar
 */
app.post('/api/whatsapp/desconectar', requireAuth, async (req: Request, res: Response) => {
    try {
        const advogadoId = req.user!.id;
        const status = await whatsappSessionManager.disconnect(advogadoId);

        res.json({
            success: true,
            data: status,
        });
    } catch (error) {
        log('error', 'Erro ao desconectar WhatsApp', error);
        sendError(
            res,
            500,
            'Erro ao desconectar WhatsApp',
            isProduction ? 'Falha ao desconectar o WhatsApp.' : error instanceof Error ? error.message : 'Erro desconhecido.'
        );
    }
});

app.all('/health', methodNotAllowed(['GET']));
app.all('/api/processos', methodNotAllowed(['POST']));
app.all('/api/processos/buscar', methodNotAllowed(['POST']));
app.all('/api/processos/opcoes', methodNotAllowed(['GET']));
app.all('/api/processos/traducao-multipla', methodNotAllowed(['POST']));
app.all('/api/processos/:numero([0-9.-]+)/traducao', methodNotAllowed(['GET']));
app.all('/api/processos/:numero([0-9.-]+)', methodNotAllowed(['GET']));
app.all('/api/meus-processos/salvar', methodNotAllowed(['POST']));
app.all('/api/dashboard', methodNotAllowed(['GET']));
app.all('/api/planos/me', methodNotAllowed(['GET']));
app.all('/api/planos/atual', methodNotAllowed(['GET']));
app.all('/api/me/plano', methodNotAllowed(['GET']));
app.all('/api/assinatura', methodNotAllowed(['GET']));
app.all('/api/planos', methodNotAllowed(['GET']));
app.all('/api/plans', methodNotAllowed(['GET']));
app.all('/api/meus-processos', methodNotAllowed(['GET']));
app.all('/api/meus-processos/:id/mensagens', methodNotAllowed(['GET']));
app.all('/api/meus-processos/:id', methodNotAllowed(['DELETE']));
app.all('/api/mensagens/:id/aprovar', methodNotAllowed(['PUT']));
app.all('/api/mensagens/:id/enviar', methodNotAllowed(['POST']));
app.all('/api/whatsapp/status', methodNotAllowed(['GET']));
app.all('/api/whatsapp/conectar', methodNotAllowed(['POST']));
app.all('/api/whatsapp/desconectar', methodNotAllowed(['POST']));

/**
 * Rota 404 - Recurso não encontrado
 */
app.use((_req: Request, res: Response) => {
    sendError(res, 404, 'Rota não encontrada', 'O recurso solicitado não existe.');
});

/**
 * Middleware de tratamento de erros
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log('error', 'Erro não tratado', err);
    sendError(
        res,
        500,
        'Erro interno do servidor',
        isProduction ? 'Ocorreu um erro inesperado.' : err.message
    );
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================

app.listen(PORT, () => {
    console.log('🚀 Servidor JurisZap Backend iniciado!');
    console.log(`📡 Rodando na porta ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log('');
    console.log('Rotas disponíveis:');
    console.log('');
    console.log('📋 Públicas:');
    console.log(`  GET  /health`);
    console.log(`  GET  /api/processos/:numero`);
    console.log(`  POST /api/processos`);
    console.log(`  GET  /api/processos/:numero/traducao`);
    console.log(`  POST /api/processos/traducao-multipla`);
    console.log('');
    console.log('🔒 Protegidas (requerem autenticação):');
    console.log(`  POST /api/meus-processos/salvar`);
    console.log(`  GET  /api/dashboard`);
    console.log(`  GET  /api/planos/me`);
    console.log(`  GET  /api/planos`);
    console.log(`  GET  /api/meus-processos`);
    console.log(`  PUT  /api/mensagens/:id/aprovar`);
    console.log(`  GET  /api/whatsapp/status`);
    console.log(`  POST /api/whatsapp/conectar`);
    console.log(`  POST /api/whatsapp/desconectar`);
    console.log('');
    console.log('💳 Pagamentos (Nexano):');
    console.log(`  POST /api/assinaturas/checkouts (Protegida)`);
    console.log(`  POST /api/webhooks/nexano (Pública)`);
    console.log('');
});

export default app;

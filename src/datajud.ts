import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

// ==========================================
// TIPOS E INTERFACES
// ==========================================

interface Movimento {
    dataHora?: string;
    complementosTabelados?: Array<{ descricao: string }>;
    [key: string]: unknown;
}

interface DadosProcesso {
    classe?: {
        nome: string;
    };
    dataUltimaAtualizacao: string;
    movimentos?: Movimento[];
    [key: string]: unknown;
}

export interface ProcessoParteEnvolvida {
    nome: string;
    papel: string;
    lado: 'ATIVO' | 'PASSIVO' | 'INDEFINIDO';
    fonte: string;
}

interface ProcessoResponse {
    classe: string | undefined;
    dataUltimaAtualizacao: string;
    movimentos: Movimento[] | undefined;
    clientesSugeridos: string[];
    partesEnvolvidas: ProcessoParteEnvolvida[];
}

interface ElasticsearchHit {
    _source: DadosProcesso;
}

interface ElasticsearchResponse {
    hits: {
        hits: ElasticsearchHit[];
    };
}

// ==========================================
// CONSTANTES
// ==========================================

const DATAJUD_BASE_URL = 'https://api-publica.datajud.cnj.jus.br';
const CNJ_NUMERO_LENGTH = 20;
const CNJ_TRIBUNAL_CODE_START = 13;
const CNJ_TRIBUNAL_CODE_END = 16;
const DEFAULT_DATAJUD_TIMEOUT_MS = 35000;
const MIN_DATAJUD_TIMEOUT_MS = 5000;
const MAX_DATAJUD_TIMEOUT_MS = 60000;
const DEFAULT_DATAJUD_RETRY_ATTEMPTS = 2;
const DEFAULT_DATAJUD_RETRY_BACKOFF_MS = 1200;

/**
 * Mapeamento de códigos J.TR do CNJ para endpoints do Datajud
 * J = Segmento da Justiça (8=Estadual, 4=Federal, 5=Trabalho, etc)
 * TR = Código do Tribunal Regional
 */
const TRIBUNAL_ENDPOINTS: Record<string, string> = {
        // ==========================================
        // JUSTIÇA ESTADUAL (J = 8)
        // ==========================================
        '801': 'api_publica_tjac', // Tribunal de Justiça do Acre
        '802': 'api_publica_tjal', // Tribunal de Justiça de Alagoas
        '803': 'api_publica_tjap', // Tribunal de Justiça do Amapá
        '804': 'api_publica_tjam', // Tribunal de Justiça do Amazonas
        '805': 'api_publica_tjba', // Tribunal de Justiça da Bahia
        '806': 'api_publica_tjce', // Tribunal de Justiça do Ceará
        '807': 'api_publica_tjdft',// TJ do Distrito Federal e Territórios
        '808': 'api_publica_tjes', // Tribunal de Justiça do Espírito Santo
        '809': 'api_publica_tjgo', // Tribunal de Justiça do Goiás
        '810': 'api_publica_tjma', // Tribunal de Justiça do Maranhão
        '811': 'api_publica_tjmt', // Tribunal de Justiça do Mato Grosso
        '812': 'api_publica_tjms', // TJ do Mato Grosso de Sul
        '813': 'api_publica_tjmg', // Tribunal de Justiça de Minas Gerais
        '814': 'api_publica_tjpa', // Tribunal de Justiça do Pará
        '815': 'api_publica_tjpb', // Tribunal de Justiça da Paraíba
        '816': 'api_publica_tjpr', // Tribunal de Justiça do Paraná
        '817': 'api_publica_tjpe', // Tribunal de Justiça de Pernambuco
        '818': 'api_publica_tjpi', // Tribunal de Justiça do Piauí
        '819': 'api_publica_tjrj', // Tribunal de Justiça do Rio de Janeiro
        '820': 'api_publica_tjrn', // TJ do Rio Grande do Norte
        '821': 'api_publica_tjrs', // Tribunal de Justiça do Rio Grande do Sul
        '822': 'api_publica_tjro', // Tribunal de Justiça de Rondônia
        '823': 'api_publica_tjrr', // Tribunal de Justiça de Roraima
        '824': 'api_publica_tjsc', // Tribunal de Justiça de Santa Catarina
        '825': 'api_publica_tjse', // Tribunal de Justiça de Sergipe
        '826': 'api_publica_tjsp', // Tribunal de Justiça de São Paulo
        '827': 'api_publica_tjto', // Tribunal de Justiça do Tocantins

        // ==========================================
        // JUSTIÇA FEDERAL (J = 4)
        // ==========================================
        '401': 'api_publica_trf1', // TRF da 1ª Região
        '402': 'api_publica_trf2', // TRF da 2ª Região
        '403': 'api_publica_trf3', // TRF da 3ª Região
        '404': 'api_publica_trf4', // TRF da 4ª Região
        '405': 'api_publica_trf5', // TRF da 5ª Região
        '406': 'api_publica_trf6', // TRF da 6ª Região

        // ==========================================
        // JUSTIÇA DO TRABALHO (J = 5)
        // ==========================================
        '501': 'api_publica_trt1',  // TRT da 1ª Região
        '502': 'api_publica_trt2',  // TRT da 2ª Região
        '503': 'api_publica_trt3',  // TRT da 3ª Região
        '504': 'api_publica_trt4',  // TRT da 4ª Região
        '505': 'api_publica_trt5',  // TRT da 5ª Região
        '506': 'api_publica_trt6',  // TRT da 6ª Região
        '507': 'api_publica_trt7',  // TRT da 7ª Região
        '508': 'api_publica_trt8',  // TRT da 8ª Região
        '509': 'api_publica_trt9',  // TRT da 9ª Região
        '510': 'api_publica_trt10', // TRT da 10ª Região
        '511': 'api_publica_trt11', // TRT da 11ª Região
        '512': 'api_publica_trt12', // TRT da 12ª Região
        '513': 'api_publica_trt13', // TRT da 13ª Região
        '514': 'api_publica_trt14', // TRT da 14ª Região
        '515': 'api_publica_trt15', // TRT da 15ª Região
        '516': 'api_publica_trt16', // TRT da 16ª Região
        '517': 'api_publica_trt17', // TRT da 17ª Região
        '518': 'api_publica_trt18', // TRT da 18ª Região
        '519': 'api_publica_trt19', // TRT da 19ª Região
        '520': 'api_publica_trt20', // TRT da 20ª Região
        '521': 'api_publica_trt21', // TRT da 21ª Região
        '522': 'api_publica_trt22', // TRT da 22ª Região
        '523': 'api_publica_trt23', // TRT da 23ª Região
        '524': 'api_publica_trt24', // TRT da 24ª Região

        // ==========================================
        // JUSTIÇA ELEITORAL (J = 6)
        // ==========================================
        '601': 'api_publica_tre-ac', // TRE do Acre
        '602': 'api_publica_tre-al', // TRE de Alagoas
        '603': 'api_publica_tre-ap', // TRE do Amapá
        '604': 'api_publica_tre-am', // TRE do Amazonas
        '605': 'api_publica_tre-ba', // TRE da Bahia
        '606': 'api_publica_tre-ce', // TRE do Ceará
        '607': 'api_publica_tre-dft',// TRE do Distrito Federal
        '608': 'api_publica_tre-es', // TRE do Espírito Santo
        '609': 'api_publica_tre-go', // TRE do Goiás
        '610': 'api_publica_tre-ma', // TRE do Maranhão
        '611': 'api_publica_tre-mt', // TRE do Mato Grosso
        '612': 'api_publica_tre-ms', // TRE do Mato Grosso de Sul
        '613': 'api_publica_tre-mg', // TRE de Minas Gerais
        '614': 'api_publica_tre-pa', // TRE do Pará
        '615': 'api_publica_tre-pb', // TRE da Paraíba
        '616': 'api_publica_tre-pr', // TRE do Paraná
        '617': 'api_publica_tre-pe', // TRE de Pernambuco
        '618': 'api_publica_tre-pi', // TRE do Piauí
        '619': 'api_publica_tre-rj', // TRE do Rio de Janeiro
        '620': 'api_publica_tre-rn', // TRE do Rio Grande do Norte
        '621': 'api_publica_tre-rs', // TRE do Rio Grande do Sul
        '622': 'api_publica_tre-ro', // TRE de Rondônia
        '623': 'api_publica_tre-rr', // TRE de Roraima
        '624': 'api_publica_tre-sc', // TRE de Santa Catarina
        '625': 'api_publica_tre-se', // TRE de Sergipe
        '626': 'api_publica_tre-sp', // TRE de São Paulo
        '627': 'api_publica_tre-to', // TRE do Tocantins

        // ==========================================
        // JUSTIÇA MILITAR ESTADUAL (J = 9) E UNIÃO
        // ==========================================
        '913': 'api_publica_tjmmg', // Tribunal Justiça Militar MG
        '921': 'api_publica_tjmrs', // Tribunal Justiça Militar RS
        '926': 'api_publica_tjmsp', // Tribunal Justiça Militar SP
        
        // ==========================================
        // TRIBUNAIS SUPERIORES (Geralmente TR = 00)
        // ==========================================
        '500': 'api_publica_tst', // Tribunal Superior do Trabalho
        '600': 'api_publica_tse', // Tribunal Superior Eleitoral
        '300': 'api_publica_stj', // Tribunal Superior de Justiça
        '700': 'api_publica_stm', // Tribunal Superior Militar
    };

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

/**
 * Normaliza o número do processo CNJ removendo caracteres não numéricos
 */
function normalizarNumeroCNJ(numeroFormatado: string): string {
    return numeroFormatado.replace(/\D/g, '');
}

/**
 * Valida se o número CNJ possui o formato correto (20 dígitos)
 */
function validarNumeroCNJ(numeroCNJ: string): void {
    if (numeroCNJ.length !== CNJ_NUMERO_LENGTH) {
        throw new Error(
            `Número CNJ inválido. Esperado ${CNJ_NUMERO_LENGTH} dígitos, recebido ${numeroCNJ.length}.`
        );
    }
}

/**
 * Extrai o código do tribunal (J.TR) do número CNJ
 * Formato CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO
 * Sem máscara: NNNNNNNDDAAAAJTROOOO
 */
function extrairCodigoTribunal(numeroCNJ: string): string {
    return numeroCNJ.substring(CNJ_TRIBUNAL_CODE_START, CNJ_TRIBUNAL_CODE_END);
}

/**
 * Obtém a URL do endpoint do tribunal baseado no código CNJ
 */
function obterEndpointTribunal(numeroCNJ: string): string {
    const codigoTribunal = extrairCodigoTribunal(numeroCNJ);
    const tribunalSlug = TRIBUNAL_ENDPOINTS[codigoTribunal];

    if (!tribunalSlug) {
        throw new Error(
            `Tribunal com código ${codigoTribunal} não está disponível no Datajud. ` +
            `Verifique se o número do processo está correto.`
        );
    }

    return `${DATAJUD_BASE_URL}/${tribunalSlug}/_search`;
}

/**
 * Valida se a API Key do Datajud está configurada
 */
function validarApiKey(): void {
    if (!process.env.DATAJUD_API_KEY) {
        throw new Error(
            'DATAJUD_API_KEY não configurada. ' +
            'Adicione a chave no arquivo .env'
        );
    }
}

function obterDatajudTimeoutMs(): number {
    const rawTimeout = Number(process.env.DATAJUD_TIMEOUT_MS || DEFAULT_DATAJUD_TIMEOUT_MS);
    if (!Number.isFinite(rawTimeout) || rawTimeout <= 0) {
        return DEFAULT_DATAJUD_TIMEOUT_MS;
    }

    return Math.min(Math.max(rawTimeout, MIN_DATAJUD_TIMEOUT_MS), MAX_DATAJUD_TIMEOUT_MS);
}

function obterDatajudRetryAttempts(): number {
    const rawAttempts = Number(process.env.DATAJUD_RETRY_ATTEMPTS || DEFAULT_DATAJUD_RETRY_ATTEMPTS);
    if (!Number.isInteger(rawAttempts) || rawAttempts < 0) {
        return DEFAULT_DATAJUD_RETRY_ATTEMPTS;
    }

    return Math.min(rawAttempts, 5);
}

function obterDatajudRetryBackoffMs(): number {
    const rawBackoff = Number(process.env.DATAJUD_RETRY_BACKOFF_MS || DEFAULT_DATAJUD_RETRY_BACKOFF_MS);
    if (!Number.isFinite(rawBackoff) || rawBackoff <= 0) {
        return DEFAULT_DATAJUD_RETRY_BACKOFF_MS;
    }

    return rawBackoff;
}

/**
 * Cria o payload para busca no Elasticsearch do Datajud
 */
function criarPayloadBusca(numeroCNJ: string) {
    return {
        query: {
            match: {
                numeroProcesso: numeroCNJ
            }
        }
    };
}

/**
 * Trata erros da API do Datajud
 */
function tratarErroDatajud(error: unknown): never {
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        if (isTimeoutError(axiosError)) {
            throw new Error('Timeout ao consultar Datajud. Tente novamente em instantes.');
        }

        const mensagem = axiosError.response?.data || axiosError.message;
        console.error('Erro ao consultar Datajud:', mensagem);
        throw new Error(`Falha na consulta ao Datajud: ${mensagem}`);
    }
    throw error;
}

function isTimeoutError(error: AxiosError): boolean {
    return (
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        (typeof error.message === 'string' && error.message.toLowerCase().includes('timeout'))
    );
}

function isRetriableStatus(status: number): boolean {
    return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function isRetriableDatajudError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
        return false;
    }

    if (isTimeoutError(error)) {
        return true;
    }

    if (!error.response?.status) {
        // Erros de rede/transporte sem status HTTP costumam ser transitórios.
        return true;
    }

    return isRetriableStatus(error.response.status);
}

function describeAxiosError(error: AxiosError): string {
    if (isTimeoutError(error)) {
        return 'timeout';
    }

    if (error.response?.status) {
        return `HTTP ${error.response.status}`;
    }

    return error.code || 'erro desconhecido';
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const PARTY_CONTEXT_KEYWORDS = [
    'polo',
    'parte',
    'autor',
    'reu',
    'réu',
    'demandante',
    'demandado',
    'impetrante',
    'impetrado',
    'requerente',
    'requerido',
    'acusado',
    'vitima',
    'vítima',
    'ofendido',
    'querelante',
    'querelado',
    'assistente',
];

const PARTY_ROLE_RULES: Array<{ keywords: string[]; papel: string; lado: 'ATIVO' | 'PASSIVO' | 'INDEFINIDO' }> = [
    { keywords: ['querelante'], papel: 'QUERELANTE', lado: 'ATIVO' },
    { keywords: ['querelado'], papel: 'QUERELADO', lado: 'PASSIVO' },
    { keywords: ['autor', 'demandante', 'impetrante', 'requerente', 'exequente'], papel: 'PARTE_ATIVA', lado: 'ATIVO' },
    { keywords: ['reu', 'réu', 'demandado', 'impetrado', 'requerido', 'executado', 'acusado'], papel: 'PARTE_PASSIVA', lado: 'PASSIVO' },
    { keywords: ['vitima', 'vítima', 'ofendido'], papel: 'VITIMA', lado: 'ATIVO' },
    { keywords: ['assistente'], papel: 'ASSISTENTE', lado: 'INDEFINIDO' },
    { keywords: ['polo ativo', 'ativo'], papel: 'POLO_ATIVO', lado: 'ATIVO' },
    { keywords: ['polo passivo', 'passivo'], papel: 'POLO_PASSIVO', lado: 'PASSIVO' },
];

function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function isPartyContext(path: string): boolean {
    const normalizedPath = normalizeText(path);
    return PARTY_CONTEXT_KEYWORDS.some((keyword) => normalizedPath.includes(normalizeText(keyword)));
}

function isLikelyPersonName(value: string): boolean {
    const trimmed = value.trim();
    if (trimmed.length < 3 || trimmed.length > 120) return false;
    if (/^\d+$/.test(trimmed)) return false;
    if (/^https?:\/\//i.test(trimmed)) return false;
    return true;
}

function inferRoleFromText(value: string): { papel: string; lado: 'ATIVO' | 'PASSIVO' | 'INDEFINIDO' } {
    const normalized = normalizeText(value);

    for (const rule of PARTY_ROLE_RULES) {
        if (rule.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))) {
            return { papel: rule.papel, lado: rule.lado };
        }
    }

    return { papel: 'PARTE', lado: 'INDEFINIDO' };
}

function pickRecordString(record: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }

    return undefined;
}

function extractPartesEnvolvidas(source: unknown): ProcessoParteEnvolvida[] {
    const found = new Map<string, ProcessoParteEnvolvida>();

    const addParty = (nome: string, roleText: string, sourcePath: string): void => {
        const trimmedName = nome.trim();
        if (!isLikelyPersonName(trimmedName)) return;

        const inferred = inferRoleFromText(roleText || sourcePath);
        const key = `${normalizeText(trimmedName)}|${inferred.papel}`;

        if (!found.has(key)) {
            found.set(key, {
                nome: trimmedName,
                papel: inferred.papel,
                lado: inferred.lado,
                fonte: sourcePath,
            });
        }
    };

    const walk = (node: unknown, path: string, depth: number): void => {
        if (depth > 12 || node === null || node === undefined) return;

        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i += 1) {
                walk(node[i], `${path}[${i}]`, depth + 1);
            }
            return;
        }

        if (typeof node !== 'object') return;

        const record = node as Record<string, unknown>;
        const currentPathIsParty = isPartyContext(path);

        const roleHint = pickRecordString(record, [
            'papel',
            'tipoParte',
            'tipo_parte',
            'tipoPolo',
            'tipo_polo',
            'polo',
            'qualificacao',
            'qualificação',
        ]);

        const nameHint = pickRecordString(record, [
            'nome',
            'nomeParte',
            'nome_parte',
            'parteNome',
            'nomePessoa',
            'nome_pessoa',
        ]);

        if (nameHint && (currentPathIsParty || !!roleHint)) {
            addParty(nameHint, roleHint || path, path || 'dadosProcesso');
        }

        for (const [key, value] of Object.entries(record)) {
            const nextPath = path ? `${path}.${key}` : key;

            if (typeof value === 'string') {
                const keyNormalized = normalizeText(key);
                const valueTrimmed = value.trim();
                const inferredFromKey = inferRoleFromText(key);
                const keyIsRoleLabel = inferredFromKey.papel !== 'PARTE';
                const keyLooksLikeName = keyNormalized === 'nomeparte' || keyNormalized.includes('nome');

                if (keyIsRoleLabel) {
                    addParty(valueTrimmed, key, nextPath);
                    continue;
                }

                if ((currentPathIsParty || keyLooksLikeName) && isLikelyPersonName(valueTrimmed)) {
                    addParty(valueTrimmed, roleHint || nextPath, nextPath);
                }

                continue;
            }

            walk(value, nextPath, depth + 1);
        }
    };

    walk(source, '', 0);

    return Array.from(found.values()).slice(0, 40);
}

function extractSuggestedClientNames(source: unknown): string[] {
    const parties = extractPartesEnvolvidas(source);
    const ranked = parties
        .sort((a, b) => {
            const scoreA = a.lado === 'ATIVO' ? 2 : a.lado === 'PASSIVO' ? 1 : 0;
            const scoreB = b.lado === 'ATIVO' ? 2 : b.lado === 'PASSIVO' ? 1 : 0;
            return scoreB - scoreA;
        })
        .map((party) => party.nome);

    return [...new Set(ranked)].slice(0, 20);
}

// ==========================================
// FUNÇÃO PRINCIPAL
// ==========================================

/**
 * Consulta um processo no Datajud pelo número CNJ
 * @param numeroProcesso - Número do processo (com ou sem formatação)
 * @returns Dados do processo ou null se não encontrado
 */
export async function consultarProcesso(
    numeroProcesso: string
): Promise<ProcessoResponse | null> {
    validarApiKey();

    const numeroCNJ = normalizarNumeroCNJ(numeroProcesso);
    validarNumeroCNJ(numeroCNJ);
    const timeoutMs = obterDatajudTimeoutMs();
    const retryAttempts = obterDatajudRetryAttempts();
    const retryBackoffMs = obterDatajudRetryBackoffMs();
    const totalAttempts = retryAttempts + 1;

    const endpoint = obterEndpointTribunal(numeroCNJ);
    const payload = criarPayloadBusca(numeroCNJ);

    let lastError: unknown;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        try {
            console.log(`Consultando processo ${numeroProcesso}...`);
            console.log(`Endpoint: ${endpoint}`);

            const response = await axios.post<ElasticsearchResponse>(endpoint, payload, {
                headers: {
                    'Authorization': `APIKey ${process.env.DATAJUD_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: timeoutMs,
            });

            const hits = response.data.hits.hits;

            if (hits.length === 0) {
                console.log('Nenhum processo encontrado.');
                return null;
            }

            const primeiroHit = hits[0];
            if (!primeiroHit) {
                console.log('Resposta inválida do Datajud.');
                return null;
            }

            const dadosProcesso = primeiroHit._source;
            const totalMovimentos = dadosProcesso.movimentos?.length || 0;

            console.log(`Processo encontrado!`);
            console.log(`Última atualização: ${dadosProcesso.dataUltimaAtualizacao}`);
            console.log(`Total de movimentações: ${totalMovimentos}`);

            return {
                classe: dadosProcesso.classe?.nome,
                dataUltimaAtualizacao: dadosProcesso.dataUltimaAtualizacao,
                movimentos: dadosProcesso.movimentos,
                clientesSugeridos: extractSuggestedClientNames(dadosProcesso),
                partesEnvolvidas: extractPartesEnvolvidas(dadosProcesso),
            };
        } catch (error) {
            lastError = error;

            if (attempt < totalAttempts && isRetriableDatajudError(error)) {
                const delay = retryBackoffMs * 2 ** (attempt - 1);
                const axiosError = error as AxiosError;

                console.warn(
                    `[Datajud] Tentativa ${attempt}/${totalAttempts} falhou (${describeAxiosError(axiosError)}). ` +
                    `Nova tentativa em ${delay}ms.`
                );

                await wait(delay);
                continue;
            }

            tratarErroDatajud(error);
        }
    }

    if (lastError) {
        tratarErroDatajud(lastError);
    }

    return null;
}

import fs from 'fs/promises';
import path from 'path';
import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    type WASocket,
    Browsers,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';

type WhatsAppConnectMode = 'qr' | 'pairing';
type WhatsAppConnectionStatus =
    | 'disconnected'
    | 'connecting'
    | 'qr_ready'
    | 'pairing_ready'
    | 'connected'
    | 'error';

interface WhatsAppSessionState {
    advogadoId: string;
    status: WhatsAppConnectionStatus;
    mode: WhatsAppConnectMode;
    qrCodeDataUrl?: string | undefined;
    pairingCode?: string | undefined;
    pairingIssuedAt?: string | undefined;
    phoneNumber?: string | undefined;
    updatedAt: string;
    error?: string | undefined;
    lastDisconnectCode?: number | undefined;
    lastDisconnectMessage?: string | undefined;
}

interface SessionEntry {
    socket: WASocket;
    state: WhatsAppSessionState;
    authDir: string;
}

const WHATSAPP_AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || '.whatsapp-sessions';
const WHATSAPP_LOG_LEVEL = process.env.WHATSAPP_LOG_LEVEL || 'silent';
const RECONNECT_DELAY_MS = Number(process.env.WHATSAPP_RECONNECT_DELAY_MS || 1500);
const waLogger = pino({ level: WHATSAPP_LOG_LEVEL });

function sanitizeId(input: string): string {
    return input.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function nowIso(): string {
    return new Date().toISOString();
}

function normalizePhoneNumber(phoneNumber: string): string {
    const inputDigits = phoneNumber.replace(/\D/g, '');
    let digits = inputDigits.startsWith('55') ? inputDigits : (inputDigits.length === 10 || inputDigits.length === 11)
        ? `55${inputDigits}`
        : inputDigits;

    if (digits.length < 12 || digits.length > 13 || !digits.startsWith('55')) {
        throw new Error('Número de telefone inválido. Informe no formato DDI+DDD+número (Brasil), por exemplo: 5585999999999.');
    }

    // Remove 9 duplicado: 55 + DDD + 99... → 55 + DDD + 9...
    // Ex: 5588996644768 → 558896644768
    if (digits.match(/^55\d{2}99/)) {
        digits = digits.slice(0, 4) + digits.slice(5);
    }

    return digits;
}

function toRecipientJid(phoneNumber: string): string {
    const normalized = normalizePhoneNumber(phoneNumber);
    return `${normalized}@s.whatsapp.net`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestPairingCodeWithRetry(socket: WASocket, phone: string): Promise<string> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            // Pequeno atraso inicial ajuda a evitar handshake prematuro no Baileys.
            await sleep(800 * attempt);
            return await socket.requestPairingCode(phone);
        } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            const retryable = /Connection Closed|Connection Failure|Timed Out|not connected|stream errored/i.test(message);

            if (!retryable || attempt === 4) {
                break;
            }
        }
    }

    const details = lastError instanceof Error ? lastError.message : String(lastError || 'Erro desconhecido');
    throw new Error(`Não foi possível gerar o código de pareamento agora. ${details}`);
}

function extractDisconnectCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') return undefined;

    const output = (error as { output?: { statusCode?: number } }).output;
    if (output?.statusCode) return output.statusCode;

    const data = (error as { data?: { statusCode?: number } }).data;
    if (data?.statusCode) return data.statusCode;

    return undefined;
}

async function ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
}

async function removeDir(dirPath: string): Promise<void> {
    await fs.rm(dirPath, { recursive: true, force: true });
}

type BaileysVersion = [number, number, number];

async function resolveBaileysVersion(): Promise<BaileysVersion | undefined> {
    try {
        const { version } = await fetchLatestBaileysVersion();
        if (Array.isArray(version) && version.length >= 3) {
            return [version[0], version[1], version[2]];
        }
        return undefined;
    } catch {
        return undefined;
    }
}

class WhatsAppSessionManager {
    private sessions = new Map<string, SessionEntry>();

    getStatus(advogadoId: string): WhatsAppSessionState {
        const session = this.sessions.get(advogadoId);
        if (!session) {
            return {
                advogadoId,
                status: 'disconnected',
                mode: 'qr',
                updatedAt: nowIso(),
            };
        }

        return { ...session.state };
    }

    async connect(
        advogadoId: string,
        options: { mode: WhatsAppConnectMode; phoneNumber?: string; forceNewSession?: boolean }
    ): Promise<WhatsAppSessionState> {
        const existing = this.sessions.get(advogadoId);
        if (
            existing
            && !options.forceNewSession
            && (
                existing.state.status === 'connected'
                || existing.state.status === 'connecting'
                || existing.state.status === 'qr_ready'
                || existing.state.status === 'pairing_ready'
            )
        ) {
            return { ...existing.state };
        }

        if (existing) {
            try {
                existing.socket.end(undefined);
            } catch {
                // noop
            }
            this.sessions.delete(advogadoId);
        }

        const sanitizedId = sanitizeId(advogadoId);
        const authDir = path.resolve(process.cwd(), WHATSAPP_AUTH_DIR, sanitizedId);

        // Em modo pairing, iniciar sessão limpa evita falhas de vínculo por credenciais parciais antigas.
        if (options.mode === 'pairing' && options.forceNewSession !== false) {
            await removeDir(authDir);
        }

        await ensureDir(authDir);

        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const version = await resolveBaileysVersion();

        const baseState: WhatsAppSessionState = {
            advogadoId,
            status: 'connecting',
            mode: options.mode,
            phoneNumber: options.phoneNumber,
            updatedAt: nowIso(),
            lastDisconnectCode: undefined,
            lastDisconnectMessage: undefined,
        };

        const socket = makeWASocket({
            auth: state,
            ...(version ? { version } : {}),
            logger: waLogger,
            printQRInTerminal: false,
            markOnlineOnConnect: false,
            browser: Browsers.macOS('Desktop'),
        });

        const entry: SessionEntry = {
            socket,
            state: baseState,
            authDir,
        };

        this.sessions.set(advogadoId, entry);

        socket.ev.on('creds.update', saveCreds);

        socket.ev.on('connection.update', async (update) => {
            const current = this.sessions.get(advogadoId);
            if (!current) return;

            if (update.qr) {
                const qrCodeDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
                current.state = {
                    ...current.state,
                    status: 'qr_ready',
                    qrCodeDataUrl,
                    pairingCode: undefined,
                    pairingIssuedAt: undefined,
                    error: undefined,
                    lastDisconnectCode: undefined,
                    lastDisconnectMessage: undefined,
                    updatedAt: nowIso(),
                };
            }

            if (update.connection === 'open') {
                current.state = {
                    ...current.state,
                    status: 'connected',
                    qrCodeDataUrl: undefined,
                    pairingCode: undefined,
                    pairingIssuedAt: undefined,
                    error: undefined,
                    lastDisconnectCode: undefined,
                    lastDisconnectMessage: undefined,
                    updatedAt: nowIso(),
                };
            }

            if (update.connection === 'close') {
                const code = extractDisconnectCode(update.lastDisconnect?.error);
                const isLoggedOut = code === DisconnectReason.loggedOut;
                const shouldFallbackToQr = isLoggedOut && current.state.mode === 'pairing';
                const closeMessage = update.lastDisconnect?.error instanceof Error
                    ? update.lastDisconnect.error.message
                    : 'Conexão encerrada pelo WhatsApp.';

                if (isLoggedOut) {
                    await removeDir(current.authDir);
                }

                current.state = {
                    ...current.state,
                    status: isLoggedOut ? 'disconnected' : 'error',
                    qrCodeDataUrl: undefined,
                    pairingCode: undefined,
                    pairingIssuedAt: undefined,
                    error: isLoggedOut
                        ? shouldFallbackToQr
                            ? 'Pareamento por código foi recusado pelo WhatsApp. Tentando conexão por QR automaticamente.'
                            : 'Sessão desconectada. Faça uma nova conexão.'
                        : `Conexão encerrada durante o pareamento. ${closeMessage}`,
                    lastDisconnectCode: code,
                    lastDisconnectMessage: closeMessage,
                    updatedAt: nowIso(),
                };

                if (shouldFallbackToQr) {
                    const sameSessionRef = current;
                    setTimeout(() => {
                        const live = this.sessions.get(advogadoId);
                        if (!live || live !== sameSessionRef) {
                            return;
                        }

                        void this.connect(advogadoId, {
                            mode: 'qr',
                            forceNewSession: true,
                        }).catch((error) => {
                            const session = this.sessions.get(advogadoId);
                            if (!session) return;

                            const message = error instanceof Error ? error.message : String(error);
                            session.state = {
                                ...session.state,
                                status: 'error',
                                error: `Fallback para QR falhou: ${message}`,
                                updatedAt: nowIso(),
                            };
                        });
                    }, 1200);
                }

                if (!isLoggedOut) {
                    const sameSessionRef = current;
                    const reconnectDelay = Number.isFinite(RECONNECT_DELAY_MS) && RECONNECT_DELAY_MS > 0
                        ? RECONNECT_DELAY_MS
                        : 1500;

                    setTimeout(() => {
                        const live = this.sessions.get(advogadoId);
                        if (!live || live !== sameSessionRef) {
                            return;
                        }

                        const reconnectOptions: {
                            mode: WhatsAppConnectMode;
                            phoneNumber?: string;
                            forceNewSession?: boolean;
                        } = {
                            mode: sameSessionRef.state.mode,
                            forceNewSession: false,
                        };

                        if (sameSessionRef.state.phoneNumber) {
                            reconnectOptions.phoneNumber = sameSessionRef.state.phoneNumber;
                        }

                        void this.connect(advogadoId, reconnectOptions).catch((error) => {
                            const session = this.sessions.get(advogadoId);
                            if (!session) return;

                            const message = error instanceof Error ? error.message : String(error);
                            session.state = {
                                ...session.state,
                                status: 'error',
                                error: `Reconexão automática falhou: ${message}`,
                                updatedAt: nowIso(),
                            };
                        });
                    }, reconnectDelay);
                }
            }
        });

        if (options.mode === 'pairing') {
            const rawPhone = options.phoneNumber || '';
            const phone = normalizePhoneNumber(rawPhone);

            await socket.waitForSocketOpen();
            const pairingCode = await requestPairingCodeWithRetry(socket, phone);

            entry.state = {
                ...entry.state,
                status: 'pairing_ready',
                pairingCode,
                pairingIssuedAt: nowIso(),
                phoneNumber: phone,
                qrCodeDataUrl: undefined,
                error: undefined,
                lastDisconnectCode: undefined,
                lastDisconnectMessage: undefined,
                updatedAt: nowIso(),
            };
        }

        return { ...entry.state };
    }

    async disconnect(advogadoId: string): Promise<WhatsAppSessionState> {
        const session = this.sessions.get(advogadoId);
        if (!session) {
            return {
                advogadoId,
                status: 'disconnected',
                mode: 'qr',
                updatedAt: nowIso(),
            };
        }

        try {
            await session.socket.logout();
        } catch {
            try {
                session.socket.end(undefined);
            } catch {
                // noop
            }
        }

        await removeDir(session.authDir);
        this.sessions.delete(advogadoId);

        return {
            advogadoId,
            status: 'disconnected',
            mode: session.state.mode,
            updatedAt: nowIso(),
            lastDisconnectCode: undefined,
            lastDisconnectMessage: undefined,
        };
    }

    async sendTextMessage(advogadoId: string, phoneNumber: string, text: string): Promise<{ messageId?: string; recipientJid: string }> {
        const session = this.sessions.get(advogadoId);

        if (!session || session.state.status !== 'connected') {
            throw new Error('WhatsApp não está conectado. Conecte o dispositivo antes de enviar mensagens.');
        }

        const normalizedText = text.trim();
        if (!normalizedText) {
            throw new Error('Texto da mensagem está vazio.');
        }

        const recipientJid = toRecipientJid(phoneNumber);
        const result = await session.socket.sendMessage(recipientJid, { text: normalizedText });
        const sentMessageId = result?.key?.id;

        return sentMessageId
            ? {
                messageId: sentMessageId,
                recipientJid,
            }
            : {
                recipientJid,
            };
    }
}

const whatsappSessionManager = new WhatsAppSessionManager();

export type { WhatsAppConnectMode, WhatsAppSessionState };
export { whatsappSessionManager };
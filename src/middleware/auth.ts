import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase.js';
import { sendError } from '../utils/errors.js';

// ==========================================
// EXTENSÃO DA INTERFACE REQUEST
// ==========================================

/**
 * Estende a interface Request do Express para incluir dados do usuário autenticado
 */
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email: string | undefined;
                role: string | undefined;
            };
        }
    }
}

// ==========================================
// MIDDLEWARE DE AUTENTICAÇÃO
// ==========================================

/**
 * Middleware que protege rotas exigindo autenticação via Supabase
 * 
 * Verifica o token JWT no header Authorization (Bearer token)
 * e valida com o Supabase Auth.
 * 
 * @example
 * app.get('/api/protected', requireAuth, (req, res) => {
 *   console.log(req.user.id); // ID do usuário autenticado
 * });
 */
export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        // Extrai o token do header Authorization
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            sendError(res, 401, 'Não autorizado', 'Token de autenticação não fornecido. Use: Authorization: Bearer <token>');
            return;
        }

        // Remove o prefixo "Bearer " para obter apenas o token
        const token = authHeader.substring(7);

        if (!token) {
            sendError(res, 401, 'Não autorizado', 'Token inválido ou ausente.');
            return;
        }

        // Valida o token com o Supabase
        const { data, error } = await supabase.auth.getUser(token);

        if (error || !data.user) {
            console.error('❌ Erro na validação do token:', error?.message);
            sendError(res, 401, 'Não autorizado', 'Token inválido ou expirado.');
            return;
        }

        // Anexa os dados do usuário ao request
        req.user = {
            id: data.user.id,
            email: data.user.email,
            role: data.user.user_metadata?.role || 'advogado',
        };

        const userEmail = req.user.email || 'sem email';
        const userId = req.user.id;
        console.log(`✅ Usuário autenticado: ${userEmail} (${userId})`);

        // Continua para a próxima função/rota
        next();

    } catch (error) {
        console.error('❌ Erro no middleware de autenticação:', error);
        sendError(res, 500, 'Erro interno', 'Erro ao processar autenticação.');
    }
}

/**
 * Middleware opcional que tenta autenticar mas não bloqueia se falhar
 * Útil para rotas que funcionam com ou sem autenticação
 */
export async function optionalAuth(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            // Sem token, continua sem usuário
            next();
            return;
        }

        const token = authHeader.substring(7);
        const { data, error } = await supabase.auth.getUser(token);

        if (!error && data.user) {
            req.user = {
                id: data.user.id,
                email: data.user.email,
                role: data.user.user_metadata?.role || 'advogado',
            };
        }

        next();

    } catch (error) {
        // Em caso de erro, apenas continua sem usuário
        console.warn('⚠️  Erro no optionalAuth:', error);
        next();
    }
}

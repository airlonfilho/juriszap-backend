import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase.js';
import { sendError } from '../utils/errors.js';

// ==========================================
// TIPOS
// ==========================================

type PlanoTipo = 'STARTER' | 'PRO' | 'INACTIVE';

interface LimitesPlano {
    STARTER: number;
    PRO: number;
    INACTIVE: number;
}

// ==========================================
// MIDDLEWARE DE LIMITE DE PROCESSOS
// ==========================================

/**
 * Middleware que verifica se o advogado atingiu o limite de processos do seu plano
 * 
 * Limites por plano:
 * - FREE: 2 processos
 * - STARTER: 10 processos
 * - PRO: 30 processos
 * - ENTERPRISE: 100 processos
 * 
 * Retorna 403 se o limite foi atingido
 */
export const checkProcessLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const advogadoId = req.user?.id;

        if (!advogadoId) {
            sendError(res, 401, 'Não autorizado', 'Você precisa estar autenticado para acessar este recurso.');
            return;
        }

        // 1. Busca o plano do advogado
        const { data: advogado, error: advError } = await supabase
            .from('Advogado')
            .select('plano')
            .eq('id', advogadoId)
            .single();

        if (advError || !advogado) {
            console.error('Erro ao buscar advogado:', advError);
            sendError(res, 500, 'Erro ao verificar plano', 'Não foi possível recuperar o plano do advogado.');
            return;
        }

        // 2. Conta quantos processos ele já tem
        const { count, error: countError } = await supabase
            .from('Processo')
            .select('*', { count: 'exact', head: true })
            .eq('advogadoId', advogadoId);

        if (countError) {
            console.error('Erro ao contar processos:', countError);
            sendError(res, 500, 'Erro ao contar processos', 'Não foi possível verificar a quantidade de processos.');
            return;
        }

        // 3. Define as regras de limites por plano
        const LIMITS: LimitesPlano = {
            STARTER: 10,
            PRO: 50,
            INACTIVE: 0
        };

        const plano: PlanoTipo =
            advogado.plano === 'STARTER' || advogado.plano === 'PRO'
                ? advogado.plano as PlanoTipo
                : 'INACTIVE';
        const userLimit = LIMITS[plano];
        const totalAtual = count || 0;

        // 4. Verifica se atingiu o limite
        if (totalAtual >= userLimit) {
            const requestIdHeader = req.get('x-request-id');
            const requestId = typeof requestIdHeader === 'string' ? requestIdHeader : 'unknown';
            
            res.status(403).json({
                success: false,
                error: 'Limite atingido',
                message: `Você atingiu o limite de ${userLimit} processos do plano ${plano}. Faça um upgrade para continuar adicionando.`,
                requestId,
                limitReached: true,
                plano: plano,
                limite: userLimit,
                atual: totalAtual
            });
            return;
        }

        // 5. Log para debug (opcional - remova em produção se preferir)
        console.log(`✅ Limite OK - Advogado ${advogadoId}: ${totalAtual}/${userLimit} processos (${plano})`);

        // Se estiver dentro do limite, segue para a rota
        next();

    } catch (error) {
        console.error('Erro no middleware de limites:', error);
        sendError(res, 500, 'Erro interno', 'Erro ao validar limites de processos.');
    }
};
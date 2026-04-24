import type { Response } from 'express';

// ==========================================
// TIPOS
// ==========================================

interface ErrorResponse {
    error: string;
    message: string;
}

interface StandardErrorResponse extends ErrorResponse {
    success: false;
    requestId: string;
}

// ==========================================
// HELPER DE ERRO
// ==========================================

/**
 * Envia uma resposta de erro padronizada com requestId para tracing
 */
export function sendError(
    res: Response,
    statusCode: number,
    error: string,
    message: string,
    realError?: unknown
): void {
    const requestIdHeader = res.getHeader('x-request-id');
    const requestId = typeof requestIdHeader === 'string' ? requestIdHeader : 'unknown';

    if (realError) {
        console.error(`[Backend Error Details] RequestId: ${requestId} | ${error}:`, realError);
    }

    const body: StandardErrorResponse = {
        success: false,
        error,
        message,
        requestId,
    };
    res.status(statusCode).json(body);
}

export type { ErrorResponse, StandardErrorResponse };

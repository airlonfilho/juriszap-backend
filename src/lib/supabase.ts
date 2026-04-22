import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// ==========================================
// SUPABASE CLIENT SETUP
// ==========================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error(
        'Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou ANON_KEY) são obrigatórias. ' +
        'Configure-as no arquivo .env'
    );
}

/**
 * Cliente Supabase configurado para autenticação e acesso ao banco de dados.
 * No backend, usamos a SERVICE_ROLE_KEY para ignorar o RLS e permitir que 
 * o servidor gerencie os dados de todos os usuários com segurança.
 */
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: false,
    },
});

export default supabase;

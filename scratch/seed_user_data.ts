// VERSÃO 6 - SEED JURISZAP (COM PROCESSO REAL VALIDADO)
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const USER_ID = process.env.USER_ID;

if (!USER_ID) {
    console.error('❌ Erro: Forneça o USER_ID como variável de ambiente.');
    process.exit(1);
}

const daysAgo = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
};

async function seed() {
    console.log(`🏠 Populando base de dados (V6 - Real Datajud Process)...`);

    // 1. Advogado PRO
    await supabase.from('Advogado').upsert({ id: USER_ID, nome: 'Dr. Airlon Filho', email: 'airlonfilho@gmail.com', plano: 'PRO' });

    // 2. Clientes
    const nomes = ['Marcos Silva', 'Ana Paula Juvêncio', 'Roberto Carlos', 'Juliana Paes', 'Antônio Fagundes', 'Fernanda Montenegro', 'Gilberto Gil', 'Caetano Veloso', 'Ivete Sangalo', 'Anitta Machado', 'Jorge Ben', 'Zeca Pagodinho'];
    const clientesData = nomes.map(nome => ({ 
        advogadoId: USER_ID, 
        nome, 
        telefone: `859${Math.floor(10000000 + Math.random() * 90000000)}` 
    }));

    console.log('🧹 Limpando dados antigos...');
    const { data: oldProcs } = await supabase.from('Processo').select('id').eq('advogadoId', USER_ID);
    if (oldProcs && oldProcs.length > 0) {
        await supabase.from('Mensagem').delete().in('processoId', oldProcs.map(p => p.id));
    }
    await supabase.from('Processo').delete().eq('advogadoId', USER_ID);
    await supabase.from('Cliente').delete().eq('advogadoId', USER_ID);

    const { data: clientes, error: cliError } = await supabase.from('Cliente').insert(clientesData).select();
    if (cliError) {
        console.error('Erro ao criar clientes:', cliError.message);
        return;
    }
    console.log(`👥 ${clientes?.length} clientes criados.`);

    // 3. Processo REAL VALIDADO (Kim Kataguiri vs. Paulo Kogos)
    const processosData = [{
        advogadoId: USER_ID,
        clienteId: clientes![0].id, // Marcos Silva
        numeroCNJ: '1180556-68.2023.8.26.0100', // PROCESSO REAL
        classe: 'Procedimento Comum Cível',
        tomDeVoz: 'OBJETIVO',
        createdAt: daysAgo(1)
    }];

    // Adiciona mais 19 simulados
    for (let i = 1; i < 20; i++) {
        const cliente = clientes![i % clientes!.length];
        processosData.push({
            advogadoId: USER_ID,
            clienteId: cliente.id,
            numeroCNJ: `${String(2000000 + i).padStart(7, '0')}-${Math.floor(10 + Math.random() * 89)}.2024.8.26.${String(Math.floor(1000 + Math.random() * 8000)).padStart(4, '0')}`,
            classe: 'Processo em Andamento',
            tomDeVoz: ['EMPATICO', 'OBJETIVO', 'DESCONTRAIDO', 'FORMAL'][i % 4],
            createdAt: daysAgo(Math.floor(Math.random() * 30))
        });
    }

    const { data: processos, error: procError } = await supabase.from('Processo').insert(processosData).select();
    if (procError) {
        console.error('Erro ao criar processos:', procError.message);
        return;
    }
    console.log(`⚖️ Processo REAL ${processos![0].numeroCNJ} inserido com sucesso!`);

    // 4. Mensagens simuladas para preencher o histórico
    const textosTecnicos = ["Publicado despacho.", "CONCLUSOS PARA SENTENÇA.", "Expedido mandado."];
    const textosTraduzidos = ["O juiz publicou uma atualização.", "O processo está pronto para a decisão final.", "Um documento oficial foi emitido."];

    const mensagensData = [];
    for (let i = 0; i < 40; i++) {
        const processo = processos![i % processos!.length];
        const index = i % textosTecnicos.length;
        mensagensData.push({
            processoId: processo.id,
            dataMovimentacao: daysAgo(Math.floor(Math.random() * 60)),
            textoTecnico: textosTecnicos[index],
            textoTraduzido: textosTraduzidos[index],
            status: 'ENVIADA'
        });
    }

    await supabase.from('Mensagem').insert(mensagensData);

    console.log(`✨ Seed V6 finalizado! Agora teste o processo 1180556-68.2023.8.26.0100.`);
}

seed();

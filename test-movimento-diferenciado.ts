import dotenv from 'dotenv';
import { translateLatestMovement } from './src/openrouterTranslator.js';

dotenv.config();

const movimentosDiferentes = [
    {
        nome: 'Distribuição',
        dataHora: '2025-01-15T10:00:00',
        orgaoJulgador: { nome: 'Tribunal de Justiça do Brasil' },
        complementosTabelados: [{ nome: 'Autuação e distribuição do processo' }]
    },
    {
        nome: 'Sentença',
        dataHora: '2025-01-10T14:30:00',
        orgaoJulgador: { nome: '1ª Vara Cível' },
        complementosTabelados: [{ nome: 'Sentença proferida pelo magistrado - Juiz condenou o réu' }]
    },
    {
        nome: 'Intimação',
        dataHora: '2025-01-05T09:15:00',
        orgaoJulgador: { nome: '1ª Vara Cível' },
        complementosTabelados: [{ nome: 'Intimação para comparecimento em audiência' }]
    },
    {
        nome: 'Recurso de Apelação',
        dataHora: '2024-12-28T11:00:00',
        orgaoJulgador: { nome: 'Tribunal de Apelação' },
        complementosTabelados: [{ nome: 'Apelação da parte contrária julgada - Mantida a sentença' }]
    },
    {
        nome: 'Juntada de Documentos',
        dataHora: '2024-12-20T15:45:00',
        orgaoJulgador: { nome: '1ª Vara Cível' },
        complementosTabelados: [{ nome: 'Petição com documentos juntada aos autos' }]
    }
];

async function testarMovimentosDiferenciados() {
    console.log('🧪 Testando traduções diferenciadas por tipo de movimentação\n');
    console.log('=' .repeat(70));

    for (let i = 0; i < movimentosDiferentes.length; i++) {
        const movimento = movimentosDiferentes[i];
        console.log(`\n📋 Movimento ${i + 1}: ${movimento.nome}`);
        console.log('-'.repeat(70));

        try {
            const resultado = await translateLatestMovement(
                [movimento],
                'Ação Civil Pública',
                'empático e tranquilizador'
            );

            console.log('✅ Relevante para o cliente:', resultado.is_relevant_for_client);
            console.log('⚖️  Requer ação do advogado:', resultado.requires_lawyer_action);
            console.log('\n📱 Mensagem WhatsApp:');
            console.log(`   "${resultado.whatsapp_message}"`);
            console.log('\n📝 Resumo para advogado:');
            console.log(`   "${resultado.lawyer_summary}"`);
            
        } catch (error) {
            console.error('❌ Erro na tradução:', error);
        }

        console.log('-'.repeat(70));
        // Pequeno delay entre requisições
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n' + '='.repeat(70));
    console.log('✨ Teste completado! As mensagens devem estar DIFERENCIADAS por tipo.');
}

testarMovimentosDiferenciados();

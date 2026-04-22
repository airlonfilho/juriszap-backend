import { translateLatestMovement, translateMultipleMovements } from './openrouterTranslator.js';
import type { DatajudMovement } from './openrouterTranslator.js';

// ==========================================
// EXEMPLO DE USO DO OPENROUTER TRANSLATOR
// ==========================================

/**
 * Exemplo de como usar o serviço de tradução via OpenRouter
 */
async function exemploDeUso() {
    
    // Dados de exemplo (simulando resposta do Datajud)
    const movimentacoesExemplo: DatajudMovement[] = [
        {
            nome: 'Conclusão',
            dataHora: '2025-12-16T12:49:10.000Z',
            orgaoJulgador: { nome: '2ª VARA CRIMINAL DA COMARCA DE IGUATU' },
            complementosTabelados: [{ nome: 'para decisão' }]
        },
        {
            nome: 'Juntada',
            dataHora: '2025-12-15T10:30:00.000Z',
            orgaoJulgador: { nome: '2ª VARA CRIMINAL DA COMARCA DE IGUATU' },
            complementosTabelados: [{ nome: 'de petição' }]
        },
        {
            nome: 'Vista ao Ministério Público',
            dataHora: '2025-12-14T08:15:00.000Z',
            orgaoJulgador: { nome: '2ª VARA CRIMINAL DA COMARCA DE IGUATU' },
            complementosTabelados: []
        }
    ];

    const classeProcesso = 'Procedimento Comum Criminal';
    const tomDesejado = 'empático e tranquilizador';

    try {
        console.log('='.repeat(60));
        console.log('EXEMPLO 1: Traduzindo a movimentação mais recente');
        console.log('='.repeat(60));

        const resultado = await translateLatestMovement(
            movimentacoesExemplo,
            classeProcesso,
            tomDesejado
        );

        console.log('\n📊 RESULTADO DA TRADUÇÃO:');
        console.log('─'.repeat(60));
        console.log(`✅ Relevante para cliente: ${resultado.is_relevant_for_client ? 'Sim' : 'Não'}`);
        console.log(`⚠️  Requer ação do advogado: ${resultado.requires_lawyer_action ? 'Sim' : 'Não'}`);
        console.log(`\n👨‍⚖️ Resumo para advogado:\n"${resultado.lawyer_summary}"`);
        console.log(`\n💬 Mensagem para WhatsApp:\n"${resultado.whatsapp_message}"`);
        console.log('─'.repeat(60));

        // ==========================================
        // EXEMPLO 2: Traduzindo múltiplas movimentações
        // ==========================================

        console.log('\n\n' + '='.repeat(60));
        console.log('EXEMPLO 2: Traduzindo as 3 movimentações mais recentes');
        console.log('='.repeat(60));

        const resultados = await translateMultipleMovements(
            movimentacoesExemplo,
            classeProcesso,
            3,
            tomDesejado
        );

        resultados.forEach((res, index) => {
            console.log(`\n📌 MOVIMENTAÇÃO ${index + 1}:`);
            console.log(`💬 "${res.whatsapp_message}"`);
        });

        console.log('\n' + '='.repeat(60));
        console.log('✅ Exemplos executados com sucesso!');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\n❌ Erro ao executar exemplo:', error);
        
        if (error instanceof Error) {
            console.error('Mensagem:', error.message);
        }
    }
}

// Executa o exemplo se este arquivo for executado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
    exemploDeUso()
        .then(() => {
            console.log('\n✅ Exemplo concluído!');
            process.exit(0);
        })
        .catch((err) => {
            console.error('\n❌ Erro fatal:', err);
            process.exit(1);
        });
}

export { exemploDeUso };

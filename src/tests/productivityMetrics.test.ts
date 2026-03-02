
import { calculateProductivityMetrics } from '../hooks/useProductivityMetrics';
import { JobControlEntry, ProcessedDataRow } from '../types';
import { logError, logWarning } from '../utils/logger';

/**
 * Simple verification script for productivity metrics calculation.
 * Since we don't have a formal testing framework, we use a Node script
 * with manual assertions.
 */

const runTests = () => {
    console.log('🚀 Iniciando verificación de calculateProductivityMetrics...');

    // Mock data
    const mockJobData: Record<string, JobControlEntry[]> = {
        '101': [
            {
                IdOperario: 101,
                IdArticulo: 'ART1',
                Cantidad: 100,
                TiempoArticulo: 0.1, // 10 mins por unidad? No, suele ser horas. Digamos 0.1h = 6 min.
                TiempoPreparacion: 0.5, // 30 mins
                FechaInicio: '2026-02-17T08:00:00',
                FechaFinal: '2026-02-17T11:00:00',
                Dataset: 'ERP',
                IdJob: 1,
                Prioridad: 1,
                Dificultad: 1
            }
        ]
    };

    const mockDatasetResumen: ProcessedDataRow[] = [
        {
            employeeId: '101',
            nombre: 'Empleado Test',
            presencia: 8,
            total: 8,
            justifica: 0,
            taj: 0,
            retrasos: 0,
            tiempoRetrasos: 0,
            fecha: '2026-02-17',
            // Otros campos omitidos para brevedad si no se usan en el cálculo
        } as any
    ];

    try {
        const metrics = calculateProductivityMetrics(mockJobData, mockDatasetResumen);

        console.log('Resultados obtenidos:', metrics);

        // Assertions
        if (metrics.averageProductivity <= 0) {
            throw new Error(`Productividad promedio debe ser > 0, obtenido: ${metrics.averageProductivity}`);
        }

        if (metrics.totalHoursWorkedInJobs <= 0) {
            throw new Error(`Total horas en trabajos debe ser > 0, obtenido: ${metrics.totalHoursWorkedInJobs}`);
        }

        console.log('✅ Verificación completada con ÉXITO.');
    } catch (error) {
        logError('❌ Verificación FALLIDA:', error);
        process.exit(1);
    }
};

// En un entorno real de Node, ejecutaríamos esto. 
// Como estamos en un entorno de navegador con Vite, esto es una referencia de cómo se probaría.
// Para ejecutarlo de verdad, necesitaríamos transpilación TS -> JS.
// runTests();

export default runTests;

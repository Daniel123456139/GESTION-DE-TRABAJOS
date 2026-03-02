/**
 * SERVICIO DE ANÁLISIS DE PRIORIDADES
 * 
 * Responsabilidad: Cruzar trabajos realizados con prioridades del Excel
 * y clasificar como URGENTE o NO_URGENTE
 * 
 * Lógica de urgencia:
 * - URGENTE: fechaRequerida <= 7 días desde fecha de análisis
 * - NO_URGENTE: fechaRequerida > 7 días o sin fecha
 */

import { differenceInCalendarDays, parseISO } from 'date-fns';
import { logError, logWarning } from '../utils/logger';
import {
    JobControlEntry,
    PriorityArticle,
    WorkClassification,
    EmployeePriorityAnalysis,
    GlobalPriorityStats
} from '../types';

const URGENCY_THRESHOLD_DAYS = 7;
const DEBUG_MODE = false; // Desactivado para producción/estabilidad

/**
 * Analiza trabajos de empleados vs prioridades del Excel
 * 
 * @param jobData - Diccionario de trabajos por empleado (employeeId -> JobControlEntry[])
 * @param priorityData - Array de artículos con prioridades del Excel
 * @param analysisDate - Fecha de referencia para el análisis
 * @returns Array de análisis por empleado
 */
export function analyzeEmployeeWorks(
    jobData: Record<string, JobControlEntry[]>,
    priorityData: PriorityArticle[],
    analysisDate: Date,
    employeeDepartments?: Record<string, string>
): EmployeePriorityAnalysis[] {
    const employeeAnalyses: EmployeePriorityAnalysis[] = [];

    // Crear mapa de prioridades por ARTÍCULO + OF (matching doble)
    // Clave compuesta: "ARTICULO|OF" (ej: "P0002901529Q90|OF26-00441")
    const priorityMap = new Map<string, PriorityArticle>();
    const fuzzyPriorityMap = new Map<string, PriorityArticle>();
    const articleOnlyMap = new Map<string, PriorityArticle[]>();
    const fuzzyArticleOnlyMap = new Map<string, PriorityArticle[]>();

    priorityData.forEach(article => {
        if (!article.articulo) return;

        const exactArticle = article.articulo.trim().toUpperCase();
        const fuzzyArticle = exactArticle.replace(/[^A-Z0-9]/g, '');

        if (!articleOnlyMap.has(exactArticle)) {
            articleOnlyMap.set(exactArticle, []);
        }
        articleOnlyMap.get(exactArticle)?.push(article);

        if (fuzzyArticle.length > 2) {
            if (!fuzzyArticleOnlyMap.has(fuzzyArticle)) {
                fuzzyArticleOnlyMap.set(fuzzyArticle, []);
            }
            fuzzyArticleOnlyMap.get(fuzzyArticle)?.push(article);
        }

        if (article.lanz) {
            // Clave EXACTA: Artículo + OF
            const exactOF = article.lanz.trim().toUpperCase();
            const exactKey = `${exactArticle}|${exactOF}`;

            // Clave FUZZY: Solo alfanuméricos (sin guiones, espacios, etc)
            const fuzzyOF = exactOF.replace(/[^A-Z0-9]/g, '');
            const fuzzyKey = `${fuzzyArticle}|${fuzzyOF}`;

            priorityMap.set(exactKey, article);
            if (fuzzyArticle.length > 2 && fuzzyOF.length > 3) {
                fuzzyPriorityMap.set(fuzzyKey, article);
            }
        }
    });

    if (DEBUG_MODE) {
        console.log('\n🎯 [Priority Analysis] Iniciando análisis con MATCHING DOBLE (Artículo + OF)');
        console.log(`📊 [Priority Analysis] Artículos en mapa EXACTO: ${priorityMap.size}`);
        console.log(`📊 [Priority Analysis] Artículos en mapa FUZZY: ${fuzzyPriorityMap.size}`);
        console.log(`👥 [Priority Analysis] Empleados a analizar: ${Object.keys(jobData).length}`);
        console.log(`📅 [Priority Analysis] Fecha de análisis: ${analysisDate.toISOString().split('T')[0]}`);
    }

    // SIEMPRE mostrar primeros trabajos ERP para diagnóstico
    const primerEmpleadoId = Object.keys(jobData)[0];
    const primerosTrabajos = jobData[primerEmpleadoId]?.slice(0, 10) || [];
    console.log(`\n🏭 PRIMEROS 10 TRABAJOS DEL ERP (IDArticulo + NOrden):`);
    primerosTrabajos.forEach((job, idx) => {
        console.log(`   ${idx + 1}. Artículo: \"${job.IDArticulo}\" | OF: \"${job.NOrden}\" - ${job.DescOperacion}`);
    });

    // Procesar cada empleado
    for (const [employeeId, jobs] of Object.entries(jobData)) {
        if (!jobs || jobs.length === 0) continue;

        const employeeName = jobs[0]?.DescOperario || `Empleado ${employeeId}`;
        const employeeDepartment = employeeDepartments?.[employeeId] || 'Sin sección';
        const employeeShift = inferEmployeeShift(jobs);
        const trabajosDetalle: WorkClassification[] = [];
        let matchesEncontrados = 0;
        let trabajosSinMatch = 0;

        // Clasificar cada trabajo del empleado
        jobs.forEach(job => {
            if (!job.IDArticulo) return; // Artículo obligatorio

            // Crear claves de matching (ARTÍCULO + OF)
            const exactArticle = job.IDArticulo.trim().toUpperCase();
            const exactOF = (job.NOrden || '').trim().toUpperCase();
            const exactKey = `${exactArticle}|${exactOF}`;

            const fuzzyArticle = exactArticle.replace(/[^A-Z0-9]/g, '');
            const fuzzyOF = exactOF.replace(/[^A-Z0-9]/g, '');
            const fuzzyKey = `${fuzzyArticle}|${fuzzyOF}`;

            // 1. Intento Exacto (Artículo + OF)
            let priorityInfo = exactOF ? priorityMap.get(exactKey) : undefined;

            // 2. Intento Fuzzy (si falla exacto)
            if (!priorityInfo && exactOF && fuzzyArticle.length > 2 && fuzzyOF.length > 3) {
                priorityInfo = fuzzyPriorityMap.get(fuzzyKey);
                if (priorityInfo && DEBUG_MODE) {
                    console.log(`✨ [Fuzzy Match] ERP: \"${exactArticle}|${exactOF}\" ↔ Excel: \"${priorityInfo.articulo}|${priorityInfo.lanz}\"`);
                }
            }

            // 3. Fallback por ARTÍCULO (solo si NO hay OF)
            if (!priorityInfo && !exactOF) {
                const candidates = articleOnlyMap.get(exactArticle);
                if (candidates && candidates.length > 0) {
                    priorityInfo = pickBestPriorityArticle(candidates, analysisDate);
                }
            }

            // 4. Fallback FUZZY por ARTÍCULO (solo si NO hay OF)
            if (!priorityInfo && !exactOF && fuzzyArticle.length > 2) {
                const candidates = fuzzyArticleOnlyMap.get(fuzzyArticle);
                if (candidates && candidates.length > 0) {
                    priorityInfo = pickBestPriorityArticle(candidates, analysisDate);
                }
            }

            // Debug: Mostrar si se encontró match
            if (priorityInfo) {
                matchesEncontrados++;
                if (DEBUG_MODE && matchesEncontrados <= 5) {
                    console.log(`✅ [Match] ERP: Artículo=\"${exactArticle}\" OF=\"${exactOF}\" ↔ Excel encontrado`);
                }
            } else {
                trabajosSinMatch++;
                if (DEBUG_MODE && trabajosSinMatch <= 10) {
                    console.log(`⚠️ [No Match] ERP: Artículo=\"${exactArticle}\" OF=\"${exactOF}\" ❌ No encontrado en Excel`);
                }
                return; // Sin match en Excel, no se clasifica
            }

            // Calcular horas dedicadas a este trabajo
            const horasDedicadas = calculateHoursWorked(job);
            if (horasDedicadas <= 0) return; // Ignorar trabajos sin tiempo válido

            // Determinar urgencia
            const urgency = calculateUrgency(
                priorityInfo?.fechaRequerida || null,
                analysisDate
            );

            // Calcular días hasta entrega
            let diasHastaEntrega: number | null = null;
            if (priorityInfo?.fechaRequerida) {
                diasHastaEntrega = differenceInCalendarDays(
                    priorityInfo.fechaRequerida,
                    analysisDate
                );
            }

            const workClassification: WorkClassification = {
                employeeId,
                employeeName,
                turno: employeeShift,
                articleId: job.IDArticulo,
                of: job.NOrden || null,
                missingOF: !job.NOrden || job.NOrden.trim() === '',
                department: employeeDepartment,
                descripcion: priorityInfo?.descripcion || job.DescOperacion || 'Sin descripción',
                cliente: priorityInfo?.cliente || 'Cliente no especificado',
                fechaRequerida: priorityInfo?.fechaRequerida || null,
                diasHastaEntrega,
                horasDedicadas,
                urgency
            };

            trabajosDetalle.push(workClassification);
        });

        // Agregar por empleado
        const analysis = aggregateByEmployee(employeeId, employeeName, employeeShift, trabajosDetalle);

        if (DEBUG_MODE && trabajosDetalle.length > 0) {
            console.log(`\n👤 [Priority Analysis] Empleado: ${employeeName}`);
            console.log(`   - Trabajos procesados: ${jobs.length}`);
            console.log(`   - Matches encontrados: ${matchesEncontrados}`);
            console.log(`   - Sin match: ${trabajosSinMatch}`);
            console.log(`   - Urgentes: ${analysis.trabajosUrgentes} (${analysis.horasUrgentes.toFixed(1)}h)`);
            console.log(`   - No urgentes: ${analysis.trabajosNoUrgentes} (${analysis.horasNoUrgentes.toFixed(1)}h)`);
        }

        if (analysis.trabajosUrgentes > 0 || analysis.trabajosNoUrgentes > 0) {
            employeeAnalyses.push(analysis);
        }
    }

    if (DEBUG_MODE) {
        console.log(`\n✅ [Priority Analysis] Análisis completado`);
        console.log(`   - Empleados con datos: ${employeeAnalyses.length}`);
        console.log(`   - Total trabajos analizados: ${employeeAnalyses.reduce((sum, e) => sum + e.trabajosUrgentes + e.trabajosNoUrgentes, 0)}`);
    }

    return employeeAnalyses;
}

/**
 * Calcula si un trabajo es urgente o no basándose en fecha requerida
 * 
 * @param fechaRequerida - Fecha de entrega al cliente (puede ser null)
 * @param analysisDate - Fecha de referencia para el análisis
 * @returns 'URGENTE' o 'NO_URGENTE'
 */
export function calculateUrgency(
    fechaRequerida: Date | null,
    analysisDate: Date
): 'URGENTE' | 'NO_URGENTE' {
    if (!fechaRequerida) {
        // Sin fecha = NO urgente
        return 'NO_URGENTE';
    }

    const daysUntilDelivery = differenceInCalendarDays(fechaRequerida, analysisDate);

    // Urgente si <= 7 días
    return daysUntilDelivery <= URGENCY_THRESHOLD_DAYS ? 'URGENTE' : 'NO_URGENTE';
}

/**
 * Calcula horas trabajadas en un JobControlEntry
 * Usa FechaInicio/HoraInicio y FechaFin/HoraFin
 * 
 * @param job - Entrada de control de trabajo
 * @returns Horas dedicadas (decimal)
 */
export function calculateHoursWorked(job: JobControlEntry): number {
    const directDuration = Number((job as unknown as { Duracion?: number }).Duracion);
    if (!job.FechaInicio || !job.HoraInicio || !job.FechaFin || !job.HoraFin) {
        return !isNaN(directDuration) && directDuration > 0 ? directDuration : 0;
    }

    try {
        // Parsear fechas en formato dd/MM/yyyy HH:mm:ss
        const startDate = parseErpDateTime(job.FechaInicio, job.HoraInicio);
        const endDate = parseErpDateTime(job.FechaFin, job.HoraFin);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return !isNaN(directDuration) && directDuration > 0 ? directDuration : 0;
        }

        const diffMillis = endDate.getTime() - startDate.getTime();
        const hours = diffMillis / (1000 * 60 * 60);

        if (hours <= 0 && !isNaN(directDuration) && directDuration > 0) {
            return directDuration;
        }

        return Math.max(0, hours); // No permitir horas negativas
    } catch (error) {
        logWarning('Error calculando horas trabajadas:', error);
        return !isNaN(directDuration) && directDuration > 0 ? directDuration : 0;
    }
}

/**
 * Selecciona el mejor artículo cuando hay múltiples OFs por ARTÍCULO
 * Prioriza la fecha requerida más próxima a la fecha de análisis
 */
function pickBestPriorityArticle(
    candidates: PriorityArticle[],
    analysisDate: Date
): PriorityArticle {
    if (candidates.length === 1) {
        return candidates[0];
    }

    let best = candidates[0];
    let bestDiff = best.fechaRequerida
        ? Math.abs(differenceInCalendarDays(best.fechaRequerida, analysisDate))
        : Number.POSITIVE_INFINITY;

    for (let i = 1; i < candidates.length; i++) {
        const candidate = candidates[i];
        const diff = candidate.fechaRequerida
            ? Math.abs(differenceInCalendarDays(candidate.fechaRequerida, analysisDate))
            : Number.POSITIVE_INFINITY;

        if (diff < bestDiff) {
            best = candidate;
            bestDiff = diff;
        }
    }

    return best;
}

/**
 * Parsea fecha y hora del ERP (formato dd/MM/yyyy HH:mm:ss)
 */
function parseErpDateTime(fecha: string, hora: string): Date {
    if (!fecha) return new Date(NaN);

    try {
        const cleanFecha = fecha.includes('T') ? fecha.split('T')[0] : fecha;

        let day: number, month: number, year: number;
        if (cleanFecha.includes('/')) {
            [day, month, year] = cleanFecha.split('/').map(Number);
        } else {
            [year, month, day] = cleanFecha.split('-').map(Number);
        }

        let cleanHora = hora || '00:00:00';
        if (cleanHora.includes('T')) {
            cleanHora = cleanHora.split('T')[1];
        }

        const [hours, minutes, seconds] = cleanHora.split(':').map(Number);
        return new Date(year, month - 1, day, hours || 0, minutes || 0, seconds || 0);
    } catch (e) {
        return new Date(NaN);
    }
}

/**
 * Agrega trabajos por empleado
 * 
 * @param employeeId - ID del empleado
 * @param employeeName - Nombre del empleado
 * @param trabajosDetalle - Array de trabajos clasificados
 * @returns Análisis agregado del empleado
 */
export function aggregateByEmployee(
    employeeId: string,
    employeeName: string,
    turno: 'M' | 'TN',
    trabajosDetalle: WorkClassification[]
): EmployeePriorityAnalysis {
    let trabajosUrgentes = 0;
    let horasUrgentes = 0;
    let trabajosNoUrgentes = 0;
    let horasNoUrgentes = 0;

    trabajosDetalle.forEach(work => {
        if (work.urgency === 'URGENTE') {
            trabajosUrgentes++;
            horasUrgentes += work.horasDedicadas;
        } else {
            trabajosNoUrgentes++;
            horasNoUrgentes += work.horasDedicadas;
        }
    });

    const totalTrabajos = trabajosUrgentes + trabajosNoUrgentes;
    const cumplimiento = totalTrabajos > 0
        ? (trabajosUrgentes / totalTrabajos) * 100
        : 0;

    return {
        employeeId,
        employeeName,
        turno,
        trabajosUrgentes,
        horasUrgentes,
        trabajosNoUrgentes,
        horasNoUrgentes,
        cumplimiento,
        trabajosDetalle
    };
}

function inferEmployeeShift(jobs: JobControlEntry[]): 'M' | 'TN' {
    let morningCount = 0;
    let afternoonCount = 0;

    jobs.forEach(job => {
        const explicitShift =
            normalizeShiftCode(job['IDTipoTurno']) ||
            normalizeShiftCode(job['TurnoTexto']) ||
            normalizeShiftCode(job['DescTurno']);

        if (explicitShift === 'M') {
            morningCount++;
            return;
        }

        if (explicitShift === 'TN') {
            afternoonCount++;
            return;
        }

        const inferredByHour = inferShiftByHour(job);
        if (inferredByHour === 'M') morningCount++;
        if (inferredByHour === 'TN') afternoonCount++;
    });

    return afternoonCount > morningCount ? 'TN' : 'M';
}

function normalizeShiftCode(value: unknown): 'M' | 'TN' | null {
    if (typeof value !== 'string') return null;

    const normalized = value.trim().toUpperCase();
    if (!normalized) return null;

    if (normalized === 'M' || normalized === 'MAÑANA' || normalized === 'MANANA') {
        return 'M';
    }

    if (
        normalized === 'TN' ||
        normalized === 'T' ||
        normalized === 'TARDE' ||
        normalized === 'TARDE/NOCHE' ||
        normalized === 'TARDE NOCHE' ||
        normalized === 'NOCHE'
    ) {
        return 'TN';
    }

    return null;
}

function inferShiftByHour(job: JobControlEntry): 'M' | 'TN' | null {
    const rawHourValues = [job.HoraInicio, job['Inicio'], job.HoraFin, job['Fin']];

    for (const rawValue of rawHourValues) {
        if (typeof rawValue !== 'string' || !rawValue.trim()) continue;
        const hour = parseHour(rawValue);
        if (hour === null) continue;

        if (hour >= 14 || hour < 6) {
            return 'TN';
        }

        return 'M';
    }

    return null;
}

function parseHour(rawTime: string): number | null {
    const clean = rawTime.trim();
    if (!clean) return null;

    const hhPart = clean.includes(':') ? clean.split(':')[0] : clean;
    const hour = Number(hhPart);

    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
        return null;
    }

    return hour;
}

/**
 * Calcula estadísticas globales del análisis
 * 
 * @param employeeAnalyses - Array de análisis por empleado
 * @returns Estadísticas globales
 */
export function calculateGlobalStats(
    employeeAnalyses: EmployeePriorityAnalysis[]
): GlobalPriorityStats {
    let totalArticulos = 0;
    let trabajosCorrectos = 0;
    let horasCorrectas = 0;
    let desviaciones = 0;
    let horasDesviadas = 0;

    employeeAnalyses.forEach(analysis => {
        trabajosCorrectos += analysis.trabajosUrgentes;
        horasCorrectas += analysis.horasUrgentes;
        desviaciones += analysis.trabajosNoUrgentes;
        horasDesviadas += analysis.horasNoUrgentes;
    });

    totalArticulos = trabajosCorrectos + desviaciones;
    const tasaExito = totalArticulos > 0
        ? (trabajosCorrectos / totalArticulos) * 100
        : 0;

    return {
        totalArticulos,
        trabajosCorrectos,
        horasCorrectas,
        desviaciones,
        horasDesviadas,
        tasaExito
    };
}

/**
 * Formatea horas en formato XXX.Xh
 * 
 * @param hours - Horas en decimal
 * @returns String formateado (ej: "125.5h")
 */
export function formatHours(hours: number): string {
    return `${hours.toFixed(1)}h`;
}

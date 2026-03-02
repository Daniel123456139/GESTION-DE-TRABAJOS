import { useState, useCallback } from 'react';
import { getOperarios, getControlOfPorOperario } from '../services/erpApi';
import { fetchFichajesBatched } from '../services/apiService';
import { getImproductiveArticle, IMPRODUCTIVE_ARTICLES } from '../data/improductiveArticles';
import { parseErpDateTime, timeToDecimalHours, extractTimeHHMM } from '../utils/datetime';
import { parseLocalDateTime } from '../utils/localDate';
import { logError, logWarning } from '../utils/logger';

export interface DashboardIncident {
    date: string;
    start: string;
    end: string;
    duration: number;
    motivoId: number;
    motivoDesc?: string;
}

export interface DashboardOperator {
    id: number;
    name: string;
    department: string;
    isProductive: boolean;
    totalHours: number;
    improductiveHours: number;
    productiveHours: number;
    breakdown: Record<string, number>;
    incidents: DashboardIncident[];
    jobCount: number;
}

export interface DashboardSection {
    name: string;
    operators: DashboardOperator[];
    totalHours: number;
    improductiveHours: number;
    productiveHours: number;
    breakdown: Record<string, number>;
}

export interface DashboardData {
    sections: DashboardSection[];
    totalOperators: number;
    totalHours: number;
    totalImproductive: number;
    totalProductive: number;
}

export const useImproductiveDashboardData = () => {
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [data, setData] = useState<DashboardData | null>(null);

    const fetchData = useCallback(async (startDate: string, endDate: string) => {
        setLoading(true);
        setProgress(0);
        try {
            const rangeStart = parseLocalDateTime(startDate, "00:00:00");
            const rangeEnd = parseLocalDateTime(endDate, "23:59:59");
            rangeEnd.setMilliseconds(999);

            const getClippedHours = (job: any): number => {
                const start = parseErpDateTime(job.FechaInicio, job.HoraInicio);
                const end = parseErpDateTime(job.FechaFin, job.HoraFin);
                if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
                const clippedStart = start < rangeStart ? rangeStart : start;
                const clippedEnd = end > rangeEnd ? rangeEnd : end;
                return timeToDecimalHours(clippedStart, clippedEnd);
            };

            const getArticleId = (job: any) => job?.IDArticulo ?? job?.Articulo ?? job?.CodArticulo ?? '';
            const getArticleDesc = (job: any) => job?.DescArticulo ?? job?.Descripcion ?? '';

            const allOperarios = await getOperarios(true);
            const validOperarios = allOperarios.filter(op => op.Activo && !op.DescOperario.toLowerCase().includes('zzz') && op.IDOperario !== 999);

            // Fichajes para incidencias
            const fichajesReq = await fetchFichajesBatched(startDate, endDate);

            const operatorFichajes = new Map<number, any[]>();
            fichajesReq.forEach(f => {
                if (!operatorFichajes.has(f.IDOperario)) operatorFichajes.set(f.IDOperario, []);
                operatorFichajes.get(f.IDOperario)!.push(f);
            });

            const sectionsMap = new Map<string, DashboardSection>();

            const getSection = (name: string): DashboardSection => {
                const safeName = name || 'SIN DEPARTAMENTO';
                if (!sectionsMap.has(safeName)) {
                    sectionsMap.set(safeName, {
                        name: safeName,
                        operators: [],
                        totalHours: 0,
                        improductiveHours: 0,
                        productiveHours: 0,
                        breakdown: {}
                    });
                }
                return sectionsMap.get(safeName)!;
            };

            const batchSize = 10;
            const totalOps = validOperarios.length;

            for (let i = 0; i < totalOps; i += batchSize) {
                const batch = validOperarios.slice(i, i + batchSize);

                await Promise.all(batch.map(async (op) => {
                    try {
                        const jobs = await getControlOfPorOperario(String(op.IDOperario), startDate, endDate);
                        const fichajes = operatorFichajes.get(op.IDOperario) || [];

                        let userTotal = 0;
                        let userImprod = 0;
                        const userBreakdown: Record<string, number> = {};

                        jobs.forEach(job => {
                            const hours = getClippedHours(job);
                            if (hours > 0) {
                                userTotal += hours;
                                const impArticle = getImproductiveArticle(getArticleId(job), getArticleDesc(job));
                                if (impArticle) {
                                    userImprod += hours;
                                    userBreakdown[impArticle.id] = (userBreakdown[impArticle.id] || 0) + hours;
                                }
                            }
                        });

                        const incidents: DashboardIncident[] = [];
                        fichajes.filter(f => f.MotivoAusencia && f.MotivoAusencia !== 1 && f.MotivoAusencia !== 0 && f.MotivoAusencia !== 14).forEach(f => {
                            incidents.push({
                                date: f.Fecha,
                                start: extractTimeHHMM(f.Inicio || f.Hora || ''),
                                end: extractTimeHHMM(f.Fin || ''),
                                duration: f.Cantidad ? Number(f.Cantidad.replace(',', '.')) || 0 : 0,
                                motivoId: Number(f.MotivoAusencia),
                                motivoDesc: f.DescMotivoAusencia
                            });
                        });

                        if (userTotal > 0 || incidents.length > 0) {
                            const section = getSection(op.DescDepartamento);
                            const opData: DashboardOperator = {
                                id: op.IDOperario,
                                name: op.DescOperario,
                                department: section.name,
                                isProductive: op.Productivo,
                                totalHours: userTotal,
                                improductiveHours: userImprod,
                                productiveHours: Math.max(0, userTotal - userImprod),
                                breakdown: userBreakdown,
                                incidents,
                                jobCount: jobs.length
                            };
                            section.operators.push(opData);
                            section.totalHours += opData.totalHours;
                            section.improductiveHours += opData.improductiveHours;
                            section.productiveHours += opData.productiveHours;

                            Object.entries(userBreakdown).forEach(([k, v]) => {
                                section.breakdown[k] = (section.breakdown[k] || 0) + v;
                            });
                        }
                    } catch (e) {
                        // ignore 
                    }
                }));

                setProgress(Math.round(((Math.min(i + batchSize, totalOps)) / totalOps) * 100));
            }

            const finalSections = Array.from(sectionsMap.values()).sort((a, b) => b.improductiveHours - a.improductiveHours); // order by most improductive
            finalSections.forEach(s => s.operators.sort((a, b) => b.improductiveHours - a.improductiveHours));

            const totalDashboardData: DashboardData = {
                sections: finalSections,
                totalOperators: finalSections.reduce((acc, s) => acc + s.operators.length, 0),
                totalHours: finalSections.reduce((acc, s) => acc + s.totalHours, 0),
                totalImproductive: finalSections.reduce((acc, s) => acc + s.improductiveHours, 0),
                totalProductive: finalSections.reduce((acc, s) => acc + s.productiveHours, 0)
            };

            setData(totalDashboardData);
            setLoading(false);

        } catch (e) {
            logError(e);
            setLoading(false);
        }
    }, []);

    return { data, loading, progress, fetchData };
};

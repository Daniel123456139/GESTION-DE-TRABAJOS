import React, { useState, useMemo, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
    Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    ComposedChart, Line,
} from 'recharts';
import {
    Clock,
    Activity,
    AlertTriangle,
    CheckCircle2,
    Users,
    TrendingDown,
    TrendingUp,
    Layers,
    RefreshCw,
    Building2,
    Sparkles
} from 'lucide-react';

import { useJobData } from '../hooks/useJobData';
import { useProductivityMetrics } from '../hooks/useProductivityMetrics';
import SmartDateInput from '../components/shared/SmartDateInput';
import { format } from 'date-fns';
import { HrLayoutContextType } from '../components/hr/HrLayout';
import { MagicCard } from '../components/ui/MagicCard';
import { cn } from '../lib/utils';
import { normalizeDateKey, parseErpDateTime, timeToDecimalHours } from '../utils/datetime';
import {
    ImproductiveScope,
    shouldIncludeImproductiveByScope
} from '../data/improductiveArticles';

const getJobArticleId = (job: any): string => {
    return (
        job?.IDArticulo ??
        job?.Articulo ??
        job?.IdArticulo ??
        job?.idArticulo ??
        job?.CodigoArticulo ??
        job?.CodArticulo ??
        ''
    );
};

const getJobArticleDesc = (job: any): string => {
    return (
        job?.DescArticulo ??
        job?.DescripcionArticulo ??
        job?.Descripcion ??
        job?.DescOperacion ??
        ''
    );
};

const getDurationHours = (job: any): number => {
    const start = parseErpDateTime(job?.FechaInicio || null, job?.HoraInicio || null);
    const end = parseErpDateTime(job?.FechaFin || null, job?.HoraFin || null);
    const hoursByRange = timeToDecimalHours(start, end);
    if (hoursByRange > 0) return hoursByRange;

    const rawDuration = job?.Duracion;
    const normalized = typeof rawDuration === 'string'
        ? Number(rawDuration.replace(',', '.'))
        : Number(rawDuration);

    return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
};

const Dashboard: React.FC = () => {
    // Filters
    const {
        computedDepartments,
        departmentFilteredEmployees,
        startDate,
        endDate,
        setStartDate,
        setEndDate,
        datasetResumen,
        employeeOptions
    } = useOutletContext<HrLayoutContextType>();
    const [selectedDept, setSelectedDept] = useState<string>('TODOS');
    const [improductiveScope, setImproductiveScope] = useState<ImproductiveScope>('all');

    // Data Hooks
    const { jobData, loading: loadingJobs, progress, debugInfo, refetch: refetchJobs } = useJobData(startDate, endDate);

    // Quick Selectors
    const setRange = (range: 'today' | 'week' | 'month' | 'prevMonth') => {
        const now = new Date();
        let start = now;
        let end = now;

        switch (range) {
            case 'today':
                start = now;
                end = now;
                break;
            case 'week':
                const day = now.getDay();
                const diff = now.getDate() - day + (day === 0 ? -6 : 1);
                start = new Date(now.setDate(diff));
                end = new Date();
                break;
            case 'month':
                start = new Date(now.getFullYear(), now.getMonth(), 1);
                end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'prevMonth':
                start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                end = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
        }
        setStartDate(format(start, 'yyyy-MM-dd'));
        setEndDate(format(end, 'yyyy-MM-dd'));
    };

    // Previous Period Calculation
    const { prevStartDate, prevEndDate } = useMemo(() => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setTime(prevEnd.getTime() - diffTime);

        return {
            prevStartDate: format(prevStart, 'yyyy-MM-dd'),
            prevEndDate: format(prevEnd, 'yyyy-MM-dd')
        };
    }, [startDate, endDate]);

    // Data Hooks - Previous Period
    const { jobData: prevJobData, refetch: refetchPrevJobs } = useJobData(prevStartDate, prevEndDate);

    // Filter Logic
    const validEmpIds = useMemo(() => {
        const baseIds = new Set(departmentFilteredEmployees.map(e => String(e.id)));

        // Sin filtros activos (global ni local): evitar filtro para maximizar rendimiento.
        const globalFilterInactive = departmentFilteredEmployees.length === employeeOptions.length;
        const localFilterInactive = selectedDept === 'TODOS';
        if (globalFilterInactive && localFilterInactive) return null;

        if (localFilterInactive) return baseIds;

        const deptIds = new Set(
            employeeOptions
                .filter(e => e.department === selectedDept)
                .map(e => String(e.id))
        );

        const intersected = new Set<string>();
        baseIds.forEach(id => {
            if (deptIds.has(id)) intersected.add(id);
        });

        return intersected;
    }, [selectedDept, departmentFilteredEmployees, employeeOptions]);

    // Metrics Calculation
    const currentMetrics = useProductivityMetrics(jobData, datasetResumen, validEmpIds, improductiveScope);
    const prevMetrics = useProductivityMetrics(prevJobData, [], validEmpIds, improductiveScope);

    const {
        totalHours,
        productiveHours,
        unproductiveHours,
        incidenceHours,
        topActions,
        topEmployees
    } = currentMetrics;

    // Derived States
    const loading = loadingJobs;
    const productivityPct = totalHours > 0 ? ((productiveHours / totalHours) * 100) : 0;
    const unprodTotal = unproductiveHours + incidenceHours;
    const unclassifiedHours = Math.max(0, totalHours - productiveHours - unprodTotal);
    const trackedHours = productiveHours + unprodTotal;
    const classificationCoveragePct = totalHours > 0 ? (trackedHours / totalHours) * 100 : 0;
    const unclassifiedPct = totalHours > 0 ? (unclassifiedHours / totalHours) * 100 : 0;

    const enrichedTopActions = useMemo(() => {
        const denominator = unprodTotal > 0 ? unprodTotal : 1;
        return topActions.map((item, idx) => ({
            ...item,
            rank: idx + 1,
            share: (item.value / denominator) * 100,
            estimatedCost: item.value * 25
        }));
    }, [topActions, unprodTotal]);

    const operationalActions = useMemo(() => {
        const actionMap = new Map<string, number>();
        Object.values(jobData).flat().forEach(job => {
            const empId = String(job.IDOperario || '');
            if (!empId) return;
            if (validEmpIds && !validEmpIds.has(empId)) return;

            const hours = getDurationHours(job);
            if (hours <= 0) return;

            const key = getJobArticleDesc(job) || getJobArticleId(job) || 'Operacion sin descripcion';
            actionMap.set(key, (actionMap.get(key) || 0) + hours);
        });

        const total = Array.from(actionMap.values()).reduce((sum, value) => sum + value, 0);
        const denominator = total > 0 ? total : 1;

        return Array.from(actionMap.entries())
            .map(([name, value], idx) => ({
                name,
                value: Number(value.toFixed(2)),
                rank: idx + 1,
                share: Number(((value / denominator) * 100).toFixed(1)),
                estimatedCost: value * 25
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10)
            .map((item, idx) => ({ ...item, rank: idx + 1 }));
    }, [jobData, validEmpIds]);

    const topActionChartData = useMemo(() => {
        if (enrichedTopActions.length > 0) {
            return {
                mode: 'improductive' as const,
                title: 'Top Acciones Improductivas',
                subtitle: 'Desglose por tipo de tarea o incidencia',
                data: enrichedTopActions
            };
        }

        if (operationalActions.length > 0) {
            return {
                mode: 'operational' as const,
                title: 'Top Operaciones Detectadas',
                subtitle: 'No se detecta improductividad clasificada en el rango',
                data: operationalActions
            };
        }

        if (unclassifiedHours > 0) {
            return {
                mode: 'unclassified' as const,
                title: 'Horas sin Detalle de Trabajo',
                subtitle: 'Existe presencia, pero sin imputaciones de OF para clasificar acciones',
                data: [{ name: 'Horas sin detalle ERP', value: Number(unclassifiedHours.toFixed(2)), rank: 1, share: 100, estimatedCost: unclassifiedHours * 25 }]
            };
        }

        return {
            mode: 'empty' as const,
            title: 'Top Acciones',
            subtitle: 'No hay datos para este rango',
            data: [] as Array<{ name: string; value: number; rank: number; share: number; estimatedCost: number }>
        };
    }, [enrichedTopActions, operationalActions, unclassifiedHours]);

    const actionEmployeesMap = useMemo(() => {
        const map = new Map<string, Map<string, { name: string; hours: number }>>();

        const ensureAction = (action: string) => {
            if (!map.has(action)) {
                map.set(action, new Map<string, { name: string; hours: number }>());
            }
            return map.get(action)!;
        };

        Object.values(jobData).flat().forEach(job => {
            const empId = String(job.IDOperario || '');
            if (!empId) return;
            if (validEmpIds && !validEmpIds.has(empId)) return;

            const hours = getDurationHours(job);
            if (hours <= 0) return;

            const actionName = getJobArticleDesc(job) || getJobArticleId(job) || 'Operacion sin descripcion';
            const empName = job.DescOperario || employeeOptions.find(e => String(e.id) === empId)?.name || `Operario ${empId}`;

            const actionBucket = ensureAction(actionName);
            const current = actionBucket.get(empId) || { name: empName, hours: 0 };
            current.hours += hours;
            actionBucket.set(empId, current);
        });

        return map;
    }, [jobData, validEmpIds, employeeOptions]);

    const [actionViewMode, setActionViewMode] = useState<'auto' | 'improductive' | 'operational' | 'unclassified'>('auto');
    const [selectedActionName, setSelectedActionName] = useState<string>('');

    const isImproductiveByScope = (job: any) => {
        return shouldIncludeImproductiveByScope(getJobArticleId(job), getJobArticleDesc(job), improductiveScope);
    };

    useEffect(() => {
        const data = actionViewMode === 'improductive'
            ? enrichedTopActions
            : actionViewMode === 'operational'
                ? operationalActions
                : actionViewMode === 'unclassified'
                    ? (unclassifiedHours > 0
                        ? [{ name: 'Horas sin detalle ERP', value: Number(unclassifiedHours.toFixed(2)), rank: 1, share: 100, estimatedCost: unclassifiedHours * 25 }]
                        : [])
                    : topActionChartData.data;

        const first = data[0]?.name || '';
        setSelectedActionName(prev => (prev && data.some(item => item.name === prev)) ? prev : first);
    }, [actionViewMode, enrichedTopActions, operationalActions, topActionChartData, unclassifiedHours]);

    const selectedActionEmployees = useMemo(() => {
        if (!selectedActionName) return [] as Array<{ name: string; hours: number; share: number }>;
        const actionBucket = actionEmployeesMap.get(selectedActionName);
        if (!actionBucket) return [] as Array<{ name: string; hours: number; share: number }>;

        const entries = Array.from(actionBucket.values()).map(item => ({ name: item.name, hours: Number(item.hours.toFixed(2)) }));
        const total = entries.reduce((sum, item) => sum + item.hours, 0);
        const denominator = total > 0 ? total : 1;

        return entries
            .map(item => ({ ...item, share: Number(((item.hours / denominator) * 100).toFixed(1)) }))
            .sort((a, b) => b.hours - a.hours)
            .slice(0, 8);
    }, [selectedActionName, actionEmployeesMap]);

    const distributionData = useMemo(() => {
        return [
            { name: 'Productivo', value: productiveHours, color: '#10b981' },
            { name: 'Tareas Impr.', value: unproductiveHours, color: '#f59e0b' },
            { name: 'Incidencias', value: incidenceHours, color: '#ef4444' },
            { name: 'Sin clasificar', value: unclassifiedHours, color: '#6366f1' }
        ].filter(item => item.value > 0);
    }, [productiveHours, unproductiveHours, incidenceHours, unclassifiedHours]);

    const dailyTrendData = useMemo(() => {
        const byDay = new Map<string, { date: string; productive: number; unproductive: number }>();

        Object.values(jobData).flat().forEach(job => {
            const empId = String(job.IDOperario || '');
            if (!empId) return;
            if (validEmpIds && !validEmpIds.has(empId)) return;

            const dateKey = normalizeDateKey(job.FechaInicio || '');
            if (!dateKey) return;

            const hours = getDurationHours(job);
            if (hours <= 0) return;

            if (!byDay.has(dateKey)) {
                byDay.set(dateKey, { date: dateKey, productive: 0, unproductive: 0 });
            }

            const row = byDay.get(dateKey)!;
            const isImproductive = isImproductiveByScope(job);
            if (isImproductive) row.unproductive += hours;
            else row.productive += hours;
        });

        const sorted = Array.from(byDay.values())
            .map(item => ({
                ...item,
                productive: Number(item.productive.toFixed(2)),
                unproductive: Number(item.unproductive.toFixed(2)),
                total: Number((item.productive + item.unproductive).toFixed(2)),
                dayLabel: item.date.slice(5) // MM-DD
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return sorted;
    }, [jobData, validEmpIds, improductiveScope]);

    const actionBoardData = useMemo(() => {
        if (actionViewMode === 'improductive') {
            return {
                mode: 'improductive' as const,
                title: 'Top Acciones Improductivas',
                subtitle: 'Desglose por tipo de tarea o incidencia',
                data: enrichedTopActions
            };
        }

        if (actionViewMode === 'operational') {
            return {
                mode: 'operational' as const,
                title: 'Top Operaciones Detectadas',
                subtitle: 'Operaciones con mayor tiempo total registrado',
                data: operationalActions
            };
        }

        if (actionViewMode === 'unclassified') {
            const data = unclassifiedHours > 0
                ? [{ name: 'Horas sin detalle ERP', value: Number(unclassifiedHours.toFixed(2)), rank: 1, share: 100, estimatedCost: unclassifiedHours * 25 }]
                : [];
            return {
                mode: 'unclassified' as const,
                title: 'Horas sin Detalle de Trabajo',
                subtitle: 'Existe presencia, pero sin imputaciones de OF para clasificar acciones',
                data
            };
        }

        return topActionChartData;
    }, [actionViewMode, enrichedTopActions, operationalActions, topActionChartData, unclassifiedHours]);

    const sectionStats = useMemo(() => {
        const deptByEmpId = new Map<string, string>();
        employeeOptions.forEach(emp => {
            deptByEmpId.set(String(emp.id), emp.department || 'Sin Seccion');
        });

        const aggregation = new Map<string, { section: string; productive: number; unproductive: number; incidences: number; totalPresence: number; employees: Set<string> }>();

        const addSection = (section: string) => {
            if (!aggregation.has(section)) {
                aggregation.set(section, {
                    section,
                    productive: 0,
                    unproductive: 0,
                    incidences: 0,
                    totalPresence: 0,
                    employees: new Set()
                });
            }
            return aggregation.get(section)!;
        };

        datasetResumen.forEach(row => {
            const empId = String(row.operario);
            if (validEmpIds && !validEmpIds.has(empId)) return;

            const section = row.colectivo || deptByEmpId.get(empId) || 'Sin Seccion';
            const bucket = addSection(section);
            bucket.employees.add(empId);
            bucket.totalPresence += (row.horasTotalesConJustificacion || 0) + (row.horasExceso || 0);
            bucket.incidences += row.hTAJ || 0;
        });

        Object.values(jobData).flat().forEach(job => {
            const empId = String(job.IDOperario || '');
            if (!empId) return;
            if (validEmpIds && !validEmpIds.has(empId)) return;

            const section = deptByEmpId.get(empId) || 'Sin Seccion';
            const bucket = addSection(section);
            bucket.employees.add(empId);

            const hours = getDurationHours(job);
            if (hours <= 0) return;

            const isImproductive = isImproductiveByScope(job);
            if (isImproductive) bucket.unproductive += hours;
            else bucket.productive += hours;
        });

        return Array.from(aggregation.values())
            .map(item => {
                const trackedHours = item.productive + item.unproductive + item.incidences;
                const effectiveTotal = trackedHours > 0 ? trackedHours : item.totalPresence;
                const productivity = effectiveTotal > 0 ? (item.productive / effectiveTotal) * 100 : 0;

                return {
                    section: item.section,
                    productive: Number(item.productive.toFixed(2)),
                    unproductive: Number(item.unproductive.toFixed(2)),
                    incidences: Number(item.incidences.toFixed(2)),
                    total: Number(effectiveTotal.toFixed(2)),
                    productivity: Number(productivity.toFixed(1)),
                    employees: item.employees.size
                };
            })
            .filter(item => item.total > 0)
            .sort((a, b) => b.unproductive - a.unproductive);
    }, [datasetResumen, employeeOptions, jobData, validEmpIds, improductiveScope]);

    // Previous Derived States
    const prevTotalHours = prevMetrics.totalHours;
    const prevProductivePct = prevTotalHours > 0 ? ((prevMetrics.productiveHours / prevTotalHours) * 100) : 0;
    const prevUnprodTotal = prevMetrics.unproductiveHours + prevMetrics.incidenceHours;

    // Trend Calculation
    const calcTrend = (curr: number, prev: number, invert: boolean = false) => {
        if (!prev || prev === 0) return { label: curr > 0 ? "+100%" : "0%", isPositive: true };
        const diff = curr - prev;
        const pct = (diff / prev) * 100;
        const label = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
        return { label, isUp: diff > 0 };
    };

    const trendTotal = calcTrend(totalHours, prevTotalHours);
    const trendProd = calcTrend(productivityPct, prevProductivePct);
    const trendUnprod = calcTrend(unprodTotal, prevUnprodTotal);
    const trendCost = calcTrend(unprodTotal * 25, prevUnprodTotal * 25);

    useEffect(() => {
        const id = window.setInterval(() => {
            refetchJobs();
            refetchPrevJobs();
        }, 90000);

        return () => window.clearInterval(id);
    }, [refetchJobs, refetchPrevJobs]);

    return (
        <div className="p-6 space-y-6 min-h-screen font-sans bg-gradient-to-br from-slate-50 via-blue-50/20 to-indigo-50/30">
            {/* Header & Filters */}
            <MagicCard className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 bg-white/40 backdrop-blur-xl border-white/40">
                <div>
                    <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 tracking-tight">
                        Control de Productividad
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">Análisis de eficiencia en tiempo real</p>
                </div>

                <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto items-center">
                    {/* Dept Selector */}
                    <div className="relative group w-full md:w-64">
                        <select
                            value={selectedDept}
                            onChange={(e) => setSelectedDept(e.target.value)}
                            className="appearance-none bg-white/50 border border-indigo-100 text-slate-700 text-sm rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 block w-full p-3 pr-8 shadow-sm transition-all hover:bg-white cursor-pointer font-bold backdrop-blur-sm"
                        >
                            <option value="TODOS">Todos los Departamentos</option>
                            {computedDepartments.map(d => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-indigo-500">
                            <Layers className="h-4 w-4" />
                        </div>
                    </div>

                    {/* Date Controls */}
                    <div className="flex flex-wrap items-center gap-2 bg-white/50 p-1.5 rounded-xl border border-indigo-100 shadow-sm backdrop-blur-sm">
                        {['today', 'week', 'month'].map((r) => (
                            <button
                                key={r}
                                onClick={() => setRange(r as any)}
                                className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-white hover:text-indigo-600 hover:shadow-md rounded-lg transition-all"
                            >
                                {r === 'today' ? 'Hoy' : r === 'week' ? 'Semana' : 'Mes'}
                            </button>
                        ))}
                        <div className="w-px h-6 bg-slate-200 mx-1"></div>
                        <div className="flex items-center gap-2">
                            <SmartDateInput value={startDate} onChange={setStartDate} className="bg-transparent border-none focus:ring-0 text-xs font-bold w-24 text-slate-700 hover:text-indigo-700 transition-colors" />
                            <span className="text-slate-300">→</span>
                            <SmartDateInput value={endDate} onChange={setEndDate} className="bg-transparent border-none focus:ring-0 text-xs font-bold w-24 text-slate-700 hover:text-indigo-700 transition-colors" />
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            refetchJobs();
                            refetchPrevJobs();
                        }}
                        className={cn(
                            "p-3 bg-white/50 text-indigo-600 rounded-xl hover:bg-white hover:shadow-lg hover:shadow-indigo-200 transition-all active:scale-95 border border-indigo-100",
                            loading && "animate-spin"
                        )}
                        title="Refrescar datos del dashboard"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                </div>
            </MagicCard>

            <MagicCard className="bg-white/80 backdrop-blur-xl border-indigo-100/50 shadow-md">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            <Layers className="w-6 h-6 text-indigo-500" />
                            <h2 className="text-xl font-black text-slate-800 tracking-tight">Alcance de Improductividad</h2>
                        </div>
                        <p className="text-sm font-medium text-slate-500">
                            Filtra qué tipo de artículos improductivos se incluyen en los cálculos del dashboard de productividad.
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row w-full xl:w-auto p-2 bg-slate-100/80 rounded-2xl border border-slate-200/50 shadow-inner gap-2">
                        <button
                            onClick={() => setImproductiveScope('all')}
                            className={`flex flex-col items-center justify-center p-3 sm:px-6 sm:py-4 rounded-xl transition-all duration-300 ${improductiveScope === 'all'
                                ? 'bg-white shadow-sm border border-indigo-200 ring-2 ring-indigo-500/20 transform scale-[1.02]'
                                : 'hover:bg-white/60 text-slate-500 hover:text-slate-700 border border-transparent'
                                }`}
                        >
                            <span className={`text-sm sm:text-base font-black ${improductiveScope === 'all' ? 'text-indigo-600' : ''}`}>Incluir todos</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${improductiveScope === 'all' ? 'text-indigo-400' : 'text-slate-400'}`}>Toda improductividad</span>
                        </button>
                        <button
                            onClick={() => setImproductiveScope('excludeAssumed')}
                            className={`flex flex-col items-center justify-center p-3 sm:px-6 sm:py-4 rounded-xl transition-all duration-300 ${improductiveScope === 'excludeAssumed'
                                ? 'bg-white shadow-sm border border-emerald-200 ring-2 ring-emerald-500/20 transform scale-[1.02]'
                                : 'hover:bg-white/60 text-slate-500 hover:text-slate-700 border border-transparent'
                                }`}
                        >
                            <span className={`text-sm sm:text-base font-black ${improductiveScope === 'excludeAssumed' ? 'text-emerald-600' : ''}`}>Quitar Asumidos</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${improductiveScope === 'excludeAssumed' ? 'text-emerald-400' : 'text-slate-400'}`}>Carro / Form / Despr / Util</span>
                        </button>
                        <button
                            onClick={() => setImproductiveScope('onlyAssumed')}
                            className={`flex flex-col items-center justify-center p-3 sm:px-6 sm:py-4 rounded-xl transition-all duration-300 ${improductiveScope === 'onlyAssumed'
                                ? 'bg-white shadow-sm border border-amber-200 ring-2 ring-amber-500/20 transform scale-[1.02]'
                                : 'hover:bg-white/60 text-slate-500 hover:text-slate-700 border border-transparent'
                                }`}
                        >
                            <span className={`text-sm sm:text-base font-black ${improductiveScope === 'onlyAssumed' ? 'text-amber-600' : ''}`}>Solo Asumidos</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${improductiveScope === 'onlyAssumed' ? 'text-amber-400' : 'text-slate-400'}`}>Carro / Form / Despr / Util</span>
                        </button>
                    </div>
                </div>
            </MagicCard>

            {loading && (
                <MagicCard className="bg-white border-white/60 animate-pulse">
                    <div className="flex items-center gap-3 mb-4">
                        <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin" />
                        <p className="text-sm font-bold text-slate-600">Actualizando metricas y graficos...</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <div className="h-16 rounded-xl bg-slate-100" />
                        <div className="h-16 rounded-xl bg-slate-100" />
                        <div className="h-16 rounded-xl bg-slate-100" />
                        <div className="h-16 rounded-xl bg-slate-100" />
                    </div>
                </MagicCard>
            )}

            {/* KPI Grid - Glassmorphism Style */}
            <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 transition-opacity duration-300 ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                <PremiumStatCard
                    title="Tiempo Imputado"
                    value={`${totalHours.toFixed(1)}h`}
                    subtext="Bruto, puede incluir solapes"
                    icon={Clock}
                    color="blue"
                    trend={trendTotal.label}
                    trendUp={trendTotal.isUp}
                />
                <PremiumStatCard
                    title="Productividad Global"
                    value={`${productivityPct.toFixed(1)}%`}
                    subtext={`${productiveHours.toFixed(1)}h productivas`}
                    icon={Activity}
                    color="emerald"
                    trend={trendProd.label}
                    trendUp={trendProd.isUp}
                />
                <PremiumStatCard
                    title="Horas Improductivas"
                    value={`${unprodTotal.toFixed(1)}h`}
                    subtext="Tareas + Incidencias"
                    icon={AlertTriangle}
                    color="amber"
                    trend={trendUnprod.label}
                    trendUp={trendUnprod.isUp}
                    inverseTrend={true}
                />
                <PremiumStatCard
                    title="Coste Estimado"
                    value={`${(unprodTotal * 25).toLocaleString('es-ES')} €`}
                    subtext="Base 25€/hora"
                    icon={TrendingDown}
                    color="rose"
                    trend={trendCost.label}
                    trendUp={trendCost.isUp}
                    inverseTrend={true}
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MagicCard className="bg-white border-white/60">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Calidad de Clasificacion</p>
                    <p className="text-2xl font-black text-slate-800 mt-1">{classificationCoveragePct.toFixed(1)}%</p>
                    <p className="text-xs font-semibold text-slate-500 mt-1">Horas clasificadas sobre total</p>
                </MagicCard>
                <MagicCard className="bg-white border-white/60">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Horas sin Clasificar</p>
                    <p className="text-2xl font-black text-indigo-600 mt-1">{unclassifiedHours.toFixed(1)}h</p>
                    <p className="text-xs font-semibold text-slate-500 mt-1">{unclassifiedPct.toFixed(1)}% del total del periodo</p>
                </MagicCard>
                <MagicCard className="bg-white border-white/60">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Base Analitica</p>
                    <p className="text-2xl font-black text-emerald-600 mt-1">{trackedHours.toFixed(1)}h</p>
                    <p className="text-xs font-semibold text-slate-500 mt-1">Productivas + improductivas + incidencias</p>
                </MagicCard>
            </div>

            {/* Main Content Grid */}
            <div className={`grid grid-cols-1 xl:grid-cols-3 gap-6 transition-opacity duration-300 ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>

                {/* Left Column: Charts */}
                <div className="xl:col-span-2 space-y-6">
                    {/* Time Distribution */}
                    <MagicCard className="h-[350px] flex flex-col bg-white">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                                Distribución de Tiempo
                            </h3>
                        </div>
                        <div className="flex-1 w-full relative">
                            {distributionData.length > 0 ? (
                                <div className="h-full flex flex-col justify-center gap-4 px-2">
                                    {distributionData.map(item => {
                                        const share = totalHours > 0 ? (item.value / totalHours) * 100 : 0;
                                        return (
                                            <div key={`dist-${item.name}`} className="group relative">
                                                <div className="flex items-center justify-between text-sm mb-1.5">
                                                    <span className="font-bold text-slate-700 flex items-center gap-1.5">
                                                        <span className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: item.color }} />
                                                        {item.name}
                                                    </span>
                                                    <span className="font-black text-slate-800 group-hover:text-indigo-600 transition-colors bg-slate-50 px-2 py-0.5 rounded-md">{item.value.toFixed(1)}h</span>
                                                </div>
                                                <div className="h-3 rounded-full bg-slate-100 overflow-hidden shadow-inner">
                                                    <div className="h-full rounded-full transition-all duration-1000 ease-out fill-mode-forwards" style={{ width: `${Math.min(share, 100)}%`, backgroundColor: item.color, backgroundImage: `linear-gradient(90deg, transparent, rgba(255,255,255,0.25))` }} />
                                                </div>
                                                <p className="text-[11px] text-slate-400 font-bold mt-1 tracking-wide uppercase">{share.toFixed(1)}% del total</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70">
                                    <p className="text-sm font-semibold text-slate-500">Todavia no hay horas para distribuir en este rango</p>
                                </div>
                            )}

                            <div className="mt-4 text-center">
                                <span className="text-3xl font-black text-slate-800">{totalHours.toFixed(0)}h</span>
                                <span className="text-sm font-semibold text-slate-400 ml-2">Total</span>
                            </div>
                        </div>
                    </MagicCard>
                </div>

                {/* Right Column: Employees */}
                <div className="xl:col-span-1 h-full">
                    <MagicCard className="h-full flex flex-col p-0 overflow-hidden bg-white border-white/50">
                        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Users className="w-5 h-5 text-rose-500" />
                                Ranking Improductividad
                            </h3>
                            <p className="text-xs text-slate-400 mt-1 font-medium">Empleados con mayor impacto</p>
                        </div>

                        <div className="flex-1 overflow-auto p-2 scrollbar-thin scrollbar-thumb-indigo-100">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead className="bg-white sticky top-0 z-10 text-xs uppercase text-slate-400 font-bold tracking-wider">
                                    <tr>
                                        <th className="p-3 bg-white">Empleado</th>
                                        <th className="p-3 text-right bg-white">Horas</th>
                                        <th className="p-3 text-center bg-white">%</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {topEmployees.length > 0 ? topEmployees.map((emp, i) => (
                                        <tr key={i} className="group hover:bg-slate-50/80 transition-all cursor-default relative">
                                            <td className="p-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm transition-transform group-hover:scale-110 ${emp.pct > 20 ? 'bg-gradient-to-br from-rose-400 to-rose-600 shadow-rose-200' : 'bg-gradient-to-br from-amber-400 to-amber-600 shadow-amber-200'}`}>
                                                        {emp.name.substring(0, 2).toUpperCase()}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-bold text-slate-700 truncate group-hover:text-indigo-600 transition-colors">
                                                            {emp.name}
                                                        </div>
                                                        <div className="w-full h-1.5 mt-1 bg-slate-100 rounded-full overflow-hidden">
                                                            <div
                                                                className={`h-full rounded-full transition-all duration-1000 ease-out fill-mode-forwards ${emp.pct > 20 ? 'bg-gradient-to-r from-rose-400 to-rose-500' : 'bg-gradient-to-r from-amber-400 to-amber-500'}`}
                                                                style={{ width: `${Math.min(emp.pct, 100)}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-3 text-right align-middle">
                                                <span className="font-black text-slate-800 text-sm">
                                                    {emp.value.toFixed(1)}<span className="text-slate-400 text-xs ml-0.5">h</span>
                                                </span>
                                            </td>
                                            <td className="p-3 text-center text-xs font-bold text-slate-400 align-middle">
                                                <span className="px-2 py-1 rounded-md bg-slate-50 text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                                                    {emp.pct.toFixed(0)}%
                                                </span>
                                            </td>
                                        </tr>
                                    )) : (
                                        <tr>
                                            <td colSpan={3} className="p-6 text-center text-sm font-semibold text-slate-400">
                                                No hay empleados con improductividad en el rango seleccionado
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-slate-50/30 text-center backdrop-blur-sm">
                            <button className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors uppercase tracking-wide">
                                Ver reporte completo
                            </button>
                        </div>
                    </MagicCard>
                </div>
            </div>

            <MagicCard className={`bg-white transition-opacity duration-300 ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-indigo-500" />
                            Evolucion Diaria
                        </h3>
                        <p className="text-sm text-slate-400 font-medium">Tendencia de horas productivas e improductivas por dia</p>
                    </div>

                </div>

                {dailyTrendData.length > 0 ? (
                    <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={dailyTrendData} margin={{ left: 8, right: 8, top: 12, bottom: 0 }}>
                                <ChartGradients />
                                <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
                                <XAxis dataKey="dayLabel" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(238, 242, 255, 0.4)' }} />
                                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: '600', color: '#64748b' }} iconType="circle" />
                                <Bar dataKey="productive" name="Productivas" fill="url(#colorProductive)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                                <Bar dataKey="unproductive" name="Improductivas" fill="url(#colorUnproductive)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                                <Line type="monotone" dataKey="total" name="Total" stroke="#2563eb" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0, fill: '#2563eb' }} filter="url(#shadow)" />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-[200px] flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 text-sm font-semibold text-slate-500">
                        Sin datos diarios suficientes para graficar tendencia
                    </div>
                )}
            </MagicCard>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <MagicCard className="bg-white">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-indigo-500" />
                                Insights de Acciones
                            </h3>
                            <p className="text-sm text-slate-400 font-medium">Pulsa una actividad para ver empleados y tiempos</p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {actionBoardData.data.length > 0 ? actionBoardData.data.slice(0, 8).map(action => (
                            <div key={`${action.name}-${action.rank}`} className="rounded-xl border border-slate-100 p-3 hover:border-indigo-100 hover:bg-indigo-50/40 transition-all">
                                <div className="flex items-center justify-between gap-4">
                                    <button
                                        onClick={() => setSelectedActionName(prev => prev === action.name ? '' : action.name)}
                                        className="min-w-0 text-left cursor-pointer"
                                    >
                                        <p className="text-xs font-black text-indigo-500">#{action.rank}</p>
                                        <p className="text-sm font-bold text-slate-700 truncate">{action.name}</p>
                                    </button>
                                    <div className="text-right shrink-0">
                                        <p className="text-sm font-black text-slate-800">{action.value.toFixed(1)}h</p>
                                        <p className="text-xs font-semibold text-slate-400">{action.share.toFixed(1)}% del total</p>
                                    </div>
                                </div>
                                <div className="mt-2 flex items-center justify-between text-xs">
                                    <div className="h-1.5 flex-1 mr-3 rounded-full bg-slate-100 overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${Math.min(action.share, 100)}%` }} />
                                    </div>
                                    <span className="font-bold text-rose-500">{action.estimatedCost.toLocaleString('es-ES')} €</span>
                                </div>
                                {selectedActionName === action.name && (
                                    <div className="mt-3 pt-3 border-t border-slate-100">
                                        {selectedActionEmployees.length > 0 ? (
                                            <div className="space-y-2">
                                                {selectedActionEmployees.map(emp => (
                                                    <div key={`${action.name}-${emp.name}`} className="flex items-center justify-between text-xs">
                                                        <span className="font-semibold text-slate-600 truncate max-w-[70%]">{emp.name}</span>
                                                        <span className="font-black text-slate-700">{emp.hours.toFixed(1)}h <span className="text-slate-400 font-semibold">({emp.share.toFixed(1)}%)</span></span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-xs font-semibold text-slate-400">No hay detalle por empleado para esta actividad.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )) : (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center text-sm font-semibold text-slate-500">
                                Sin datos suficientes para insights en este rango
                            </div>
                        )}
                    </div>
                </MagicCard>

                <MagicCard className="bg-white">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                                <Building2 className="w-5 h-5 text-blue-500" />
                                Estadisticas por Seccion
                            </h3>
                            <p className="text-sm text-slate-400 font-medium">Comparativa de horas productivas, improductivas e incidencias</p>
                        </div>
                    </div>

                    {sectionStats.length > 0 ? (
                        <div className="h-[360px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={sectionStats.slice(0, 8)} margin={{ left: 10, right: 10, top: 10, bottom: 0 }}>
                                    <ChartGradients />
                                    <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="section" tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} interval={0} angle={-12} textAnchor="end" height={50} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(238, 242, 255, 0.4)' }} />
                                    <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: '600', color: '#64748b' }} iconType="circle" />
                                    <Bar yAxisId="left" dataKey="productive" name="Productivas" fill="url(#colorProductive)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                                    <Bar yAxisId="left" dataKey="unproductive" name="Improductivas" fill="url(#colorUnproductive)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                                    <Bar yAxisId="left" dataKey="incidences" name="Incidencias" fill="url(#colorIncidences)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                                    <Line yAxisId="right" type="monotone" dataKey="productivity" name="Productividad" stroke="#2563eb" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0, fill: '#2563eb' }} filter="url(#shadow)" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="h-[260px] flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 text-sm font-semibold text-slate-500">
                            Sin estadisticas de seccion para este rango
                        </div>
                    )}
                </MagicCard>
            </div>

            {/* Debugging Panel */}
            <div className="mt-8 p-4 bg-slate-100/50 rounded-xl text-xs font-mono text-slate-600 border border-slate-200">
                <details>
                    <summary className="cursor-pointer font-bold opacity-70 hover:opacity-100 transition-opacity">
                        🛠️ Panel de Diagnóstico (Solo Desarrollador)
                    </summary>
                    <div className="mt-4 grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <p><strong>Rango Fechas:</strong> {startDate} al {endDate}</p>
                            <p><strong>Departamento Actual:</strong> {selectedDept}</p>
                            <p className="p-2 bg-slate-200 rounded">
                                <strong>Progreso Carga:</strong>{' '}
                                {progress ? `${progress.processed} / ${progress.total}` : 'Inactivo'}
                            </p>
                        </div>
                        <div className="space-y-2">
                            <p><strong>Debug Info:</strong></p>
                            <pre className="bg-slate-800 text-green-400 p-2 rounded overflow-auto max-h-40">
                                {JSON.stringify(debugInfo, null, 2)}
                            </pre>
                        </div>
                    </div>
                </details>
            </div>
        </div>
    );
};

// --- Premium Sub-components ---

const PremiumStatCard = ({ title, value, subtext, icon: Icon, color, trend, trendUp, inverseTrend }: any) => {
    const colorStyles: any = {
        blue: 'from-blue-500 to-indigo-600 shadow-blue-200 text-blue-500',
        emerald: 'from-emerald-500 to-teal-600 shadow-emerald-200 text-emerald-500',
        amber: 'from-amber-400 to-orange-500 shadow-amber-200 text-amber-500',
        rose: 'from-rose-500 to-pink-600 shadow-rose-200 text-rose-500',
    };

    const style = colorStyles[color] || colorStyles.blue;
    // Extract text color class for icon
    const textColor = style.split(' ').find((c: string) => c.startsWith('text-'));

    // Logic for trend color: 
    const isGood = inverseTrend ? !trendUp : trendUp;
    const trendColor = isGood ? 'text-emerald-600 bg-emerald-100/50' : 'text-rose-600 bg-rose-100/50';
    const TrendIcon = trendUp ? TrendingUp : TrendingDown;

    return (
        <MagicCard className="bg-white border-white/60 relative overflow-hidden group hover:-translate-y-1 transition-all duration-300">
            <div className={`absolute -right-6 -top-6 p-4 opacity-[0.03] group-hover:opacity-10 transition-opacity duration-500`}>
                <Icon className={`w-32 h-32 transform rotate-12 ${textColor}`} />
            </div>

            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <div className={`p-3.5 rounded-2xl bg-gradient-to-br ${style.split(' ').slice(0, 2).join(' ')} text-white shadow-lg shadow-indigo-500/20 ring-4 ring-white`}>
                        <Icon className="w-6 h-6" />
                    </div>
                    {trend && (
                        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${trendColor}`}>
                            <TrendIcon className="w-3.5 h-3.5" />
                            {trend}
                        </div>
                    )}
                </div>

                <div>
                    <h3 className="text-4xl font-black text-slate-800 tracking-tight mt-2">{value}</h3>
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-wide mt-1 mb-0.5">{title}</p>
                    <p className="text-xs font-medium text-slate-400/80">{subtext}</p>
                </div>
            </div>
        </MagicCard>
    );
};

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white/90 backdrop-blur-md rounded-2xl shadow-2xl border border-white/60 p-4 min-w-[180px]">
                <p className="text-sm font-black text-slate-800 mb-3 border-b border-slate-100 pb-2">{label}</p>
                <div className="space-y-2.5">
                    {payload.map((entry: any, index: number) => {
                        let bgColor = entry.color;
                        if (entry.dataKey === 'productive') bgColor = '#10b981';
                        if (entry.dataKey === 'unproductive') bgColor = '#f59e0b';
                        if (entry.dataKey === 'incidences') bgColor = '#ef4444';
                        if (entry.dataKey === 'total' || entry.dataKey === 'productivity') bgColor = '#2563eb';

                        return (
                            <div key={index} className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: bgColor }} />
                                    <span className="text-xs font-bold text-slate-600">{entry.name}</span>
                                </div>
                                <span className="text-sm font-black text-slate-800">
                                    {Number(entry.value).toFixed(1)}{entry.name === 'Productividad' ? '%' : 'h'}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>
        );
    }
    return null;
};

const ChartGradients = () => (
    <defs>
        <linearGradient id="colorProductive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.95} />
            <stop offset="95%" stopColor="#059669" stopOpacity={0.8} />
        </linearGradient>
        <linearGradient id="colorUnproductive" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.95} />
            <stop offset="95%" stopColor="#d97706" stopOpacity={0.8} />
        </linearGradient>
        <linearGradient id="colorIncidences" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.95} />
            <stop offset="95%" stopColor="#dc2626" stopOpacity={0.8} />
        </linearGradient>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#2563eb" floodOpacity="0.3" />
        </filter>
    </defs>
);

export default Dashboard;

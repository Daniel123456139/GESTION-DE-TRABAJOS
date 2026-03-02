import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Layers, Activity, Calendar, ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react';
import { useImproductiveDashboardData } from '../hooks/useImproductiveDashboardData';
import SmartDateInput from '../components/shared/SmartDateInput';
import { getSmartDefaultDateRange } from '../utils/localDate';
import { ImproductiveBySection } from '../components/job/ImproductiveBySection';
import { ImproductiveByActivity } from '../components/job/ImproductiveByActivity';

export default function ImproductiveDashboards() {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();

    // Default to 'section'
    const view = searchParams.get('view') === 'activity' ? 'activity' : 'section';

    const defaults = getSmartDefaultDateRange();
    const [startDate, setStartDate] = useState(defaults.startDate);
    const [endDate, setEndDate] = useState(defaults.endDate);

    const { data, loading, progress, fetchData } = useImproductiveDashboardData();

    // Auto-fetch on mount
    useEffect(() => {
        if (startDate && endDate) {
            fetchData(startDate, endDate);
        }
    }, []); // eslint-disable-line

    const handleFetch = () => {
        if (startDate && endDate) {
            fetchData(startDate, endDate);
        }
    };

    const setView = (newView: 'section' | 'activity') => {
        setSearchParams({ view: newView });
    };

    return (
        <div className="p-4 md:p-8 bg-slate-50 min-h-screen">
            {/* Header */}
            <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/gestion-trabajos/jobs')}
                        className="p-2 hover:bg-white rounded-full transition-colors text-slate-500 hover:text-indigo-600 shadow-sm"
                        title="Volver a Partes de Trabajo"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-600 to-orange-600 flex items-center gap-2">
                            <AlertTriangle className="text-orange-500 w-7 h-7" />
                            Análisis de Improductivos
                        </h1>
                        <p className="text-slate-500 text-sm mt-1">
                            Dashboard interactivo de pérdidas y desviaciones de tiempo
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-end gap-3 custom-filters bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">Desde</label>
                        <SmartDateInput
                            value={startDate}
                            onChange={setStartDate}
                            className="bg-slate-50 border-slate-200 text-sm py-1.5 px-3 rounded-md w-[140px] focus:ring-orange-500"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 ml-1">Hasta</label>
                        <SmartDateInput
                            value={endDate}
                            onChange={setEndDate}
                            className="bg-slate-50 border-slate-200 text-sm py-1.5 px-3 rounded-md w-[140px] focus:ring-orange-500"
                        />
                    </div>
                    <button
                        onClick={handleFetch}
                        disabled={loading}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-white font-medium shadow-sm transition-all text-sm
                            ${loading ? 'bg-orange-400 cursor-wait' : 'bg-orange-600 hover:bg-orange-700 active:scale-95'}`}
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        {loading ? 'Analizando...' : 'Actualizar'}
                    </button>
                </div>
            </header>

            {/* Progress Bar */}
            {loading && (
                <div className="w-full bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 animate-pulse">
                    <div className="flex justify-between text-xs font-bold text-slate-500 mb-2 uppercase tracking-widest">
                        <span>Extrayendo partes e incidencias...</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-orange-400 to-red-500 transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Navigation Tabs */}
            {!loading && data && (
                <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm mb-6 w-full max-w-md mx-auto relative z-10">
                    <button
                        onClick={() => setView('section')}
                        className={`flex-1 flex justify-center items-center gap-2 py-2.5 px-4 rounded-lg text-sm font-bold transition-all ${view === 'section'
                                ? 'bg-orange-50 text-orange-700 shadow-sm border border-orange-100'
                                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                            }`}
                    >
                        <Layers className="w-4 h-4" />
                        Vista por Sección
                    </button>
                    <button
                        onClick={() => setView('activity')}
                        className={`flex-1 flex justify-center items-center gap-2 py-2.5 px-4 rounded-lg text-sm font-bold transition-all ${view === 'activity'
                                ? 'bg-orange-50 text-orange-700 shadow-sm border border-orange-100'
                                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                            }`}
                    >
                        <Activity className="w-4 h-4" />
                        Vista por Actividad
                    </button>
                </div>
            )}

            {/* Content Area */}
            {!loading && data && (
                <div className="animate-fadeIn mt-4">
                    {view === 'section' ? (
                        <ImproductiveBySection data={data} />
                    ) : (
                        <ImproductiveByActivity data={data} />
                    )}
                </div>
            )}

            {/* Empty State */}
            {!loading && !data && (
                <div className="flex flex-col justify-center items-center py-20 bg-white rounded-2xl border border-slate-200 border-dashed">
                    <Calendar className="w-16 h-16 text-slate-200 mb-4" />
                    <h3 className="text-xl font-bold text-slate-600 mb-2">Listo para analizar</h3>
                    <p className="text-slate-400 text-sm">Selecciona las fechas y pulsa "Actualizar" para comenzar el análisis.</p>
                </div>
            )}
        </div>
    );
}

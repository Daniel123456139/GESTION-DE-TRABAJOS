import React, { useMemo, useState } from 'react';
import { DashboardData } from '../../hooks/useImproductiveDashboardData';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { AlertCircle, Clock, Users, Zap, Search, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { IMPRODUCTIVE_ARTICLES } from '../../data/improductiveArticles';

export const ImproductiveBySection: React.FC<{ data: DashboardData }> = ({ data }) => {
    const [expandedSection, setExpandedSection] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const chartData = useMemo(() => {
        return data.sections.map(s => ({
            name: s.name,
            Productivas: s.productiveHours.toFixed(2),
            Improductivas: s.improductiveHours.toFixed(2),
            Total: s.totalHours.toFixed(2),
            Porcentaje: s.totalHours > 0 ? ((s.improductiveHours / s.totalHours) * 100).toFixed(1) : 0
        })).sort((a, b) => Number(b.Improductivas) - Number(a.Improductivas)); // Worst first
    }, [data.sections]);

    const getArticleName = (id: string) => {
        return IMPRODUCTIVE_ARTICLES.find(a => a.id === id)?.desc || id;
    };

    const formatHours = (h: number) => {
        const hrs = Math.floor(h);
        const mins = Math.round((h - hrs) * 60);
        return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
    };

    const globalPercentage = data.totalHours > 0 ? ((data.totalImproductive / data.totalHours) * 100).toFixed(1) : '0.0';

    return (
        <div className="space-y-6">
            {/* Global KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 bg-orange-50 w-24 h-24 rounded-full opacity-50"></div>
                    <div className="p-3 bg-slate-50 text-slate-500 rounded-xl">
                        <Users className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Operarios</p>
                        <p className="text-2xl font-black text-slate-800">{data.totalOperators}</p>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4 relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 bg-indigo-50 w-24 h-24 rounded-full opacity-50"></div>
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                        <Clock className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1">Horas Totales</p>
                        <p className="text-2xl font-black text-slate-800">{formatHours(data.totalHours)}</p>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-2xl border border-red-200 shadow-lg shadow-red-500/10 flex items-center gap-4 relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 bg-red-50 w-24 h-24 rounded-full opacity-50"></div>
                    <div className="p-3 bg-red-100 text-red-600 rounded-xl">
                        <AlertCircle className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1">Horas Pérdida</p>
                        <p className="text-2xl font-black text-red-600">{formatHours(data.totalImproductive)}</p>
                    </div>
                </div>

                <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-5 rounded-2xl shadow-lg flex items-center gap-4 relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 bg-white/5 w-24 h-24 rounded-full"></div>
                    <div className="p-3 bg-white/10 text-white rounded-xl">
                        <Zap className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">% Desviación</p>
                        <p className="text-2xl font-black text-white">{globalPercentage}%</p>
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <BarChart className="text-orange-500 w-5 h-5" />
                    Distribución por Sección
                </h3>
                <div className="w-full h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                            <XAxis
                                dataKey="name"
                                angle={-45}
                                textAnchor="end"
                                height={80}
                                interval={0}
                                tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                                tickLine={false}
                                axisLine={false}
                            />
                            <YAxis
                                yAxisId="left"
                                tick={{ fontSize: 12, fill: '#64748b' }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(val) => `${val}h`}
                            />
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                tick={{ fontSize: 12, fill: '#ef4444' }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(val) => `${val}%`}
                            />
                            <Tooltip
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Bar yAxisId="left" dataKey="Productivas" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} barSize={40} />
                            <Bar yAxisId="left" dataKey="Improductivas" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={40} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Details Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="font-bold text-slate-800">Desglose Detallado</h3>
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar sección..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none w-64 transition-all"
                        />
                    </div>
                </div>

                <div className="divide-y divide-slate-100">
                    {data.sections.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())).map((section, idx) => {
                        const isExpanded = expandedSection === section.name;
                        const percentage = section.totalHours > 0 ? ((section.improductiveHours / section.totalHours) * 100).toFixed(1) : 0;
                        const hasHighImproductive = Number(percentage) > 15; // >15% is marked in red

                        return (
                            <div key={section.name} className={`transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/50'}`}>
                                <div
                                    className="p-4 flex items-center justify-between cursor-pointer"
                                    onClick={() => setExpandedSection(isExpanded ? null : section.name)}
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className={`w-10 h-10 rounded-xl flexitems-center justify-center shrink-0 font-bold ${hasHighImproductive ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                                            }`}>
                                            <div className="w-full h-full flex items-center justify-center">{idx + 1}</div>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 text-base">{section.name}</h4>
                                            <p className="text-xs text-slate-500 mt-0.5">{section.operators.length} operarios analizados</p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-8 md:gap-16">
                                        <div className="hidden md:block text-right">
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Total</p>
                                            <p className="font-medium text-slate-700">{formatHours(section.totalHours)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-1">Pérdida</p>
                                            <p className={`font-bold ${hasHighImproductive ? 'text-red-600' : 'text-orange-500'}`}>{formatHours(section.improductiveHours)}</p>
                                        </div>
                                        <div className="text-right w-16">
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">%</p>
                                            <div className={`px-2 py-0.5 rounded-md inline-block text-sm font-bold ${hasHighImproductive ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                                                }`}>
                                                {percentage}%
                                            </div>
                                        </div>
                                        <div className="text-slate-400 ml-2">
                                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Content */}
                                {isExpanded && (
                                    <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-white">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {/* Top Activities in this section */}
                                            <div>
                                                <h5 className="font-bold text-xs text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                    <Activity className="w-3.5 h-3.5" />
                                                    Motivos Principales
                                                </h5>
                                                <div className="space-y-2">
                                                    {Object.entries(section.breakdown)
                                                        .sort(([, a], [, b]) => b - a)
                                                        .slice(0, 5) // Top 5
                                                        .map(([code, hours]) => (
                                                            <div key={code} className="flex justify-between items-center text-sm p-2 rounded-lg bg-slate-50 border border-slate-100">
                                                                <span className="font-medium text-slate-700 line-clamp-1 mr-4">{getArticleName(code)} <span className="text-xs text-slate-400 ml-1">({code})</span></span>
                                                                <span className="font-bold text-red-500 whitespace-nowrap">{formatHours(hours)}</span>
                                                            </div>
                                                        ))
                                                    }
                                                    {Object.keys(section.breakdown).length === 0 && (
                                                        <p className="text-sm text-slate-400 italic">No hay registros improductivos</p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Worst offenders */}
                                            <div>
                                                <h5 className="font-bold text-xs text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                    <Users className="w-3.5 h-3.5" />
                                                    Operarios Implicados
                                                </h5>
                                                <div className="space-y-2">
                                                    {section.operators
                                                        .filter(op => op.improductiveHours > 0)
                                                        .slice(0, 5)
                                                        .map(op => {
                                                            const opP = ((op.improductiveHours / op.totalHours) * 100).toFixed(1);
                                                            return (
                                                                <div key={op.id} className="flex justify-between items-center text-sm p-2 rounded-lg border border-red-100 bg-red-50/30">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-[10px] font-bold">
                                                                            {op.id.toString().slice(-2)}
                                                                        </div>
                                                                        <span className="font-bold text-slate-700">{op.name}</span>
                                                                    </div>
                                                                    <div className="text-right">
                                                                        <span className="font-bold text-red-600 mr-2">{formatHours(op.improductiveHours)}</span>
                                                                        <span className="text-xs font-bold px-1.5 py-0.5 bg-white text-red-400 rounded-sm border border-red-100">{opP}%</span>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })
                                                    }
                                                    {section.operators.filter(op => op.improductiveHours > 0).length === 0 && (
                                                        <p className="text-sm text-slate-400 italic">Nadie ha registrado improductivos</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

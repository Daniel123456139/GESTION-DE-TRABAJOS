import React, { useMemo, useState } from 'react';
import { DashboardData } from '../../hooks/useImproductiveDashboardData';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Target, Search, ChevronDown, ChevronUp, Users, Clock, AlertTriangle } from 'lucide-react';
import { IMPRODUCTIVE_ARTICLES } from '../../data/improductiveArticles';

interface ActivitySummary {
    id: string;
    name: string;
    totalHours: number;
    operators: { id: number; name: string; hours: number; department: string }[];
}

export const ImproductiveByActivity: React.FC<{ data: DashboardData }> = ({ data }) => {
    const [expandedActivity, setExpandedActivity] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const activities = useMemo(() => {
        const actMap = new Map<string, ActivitySummary>();

        data.sections.forEach(sec => {
            sec.operators.forEach(op => {
                Object.entries(op.breakdown).forEach(([artId, hours]) => {
                    if (!actMap.has(artId)) {
                        actMap.set(artId, {
                            id: artId,
                            name: IMPRODUCTIVE_ARTICLES.find(a => a.id === artId)?.desc || artId,
                            totalHours: 0,
                            operators: []
                        });
                    }
                    const act = actMap.get(artId)!;
                    act.totalHours += hours;
                    act.operators.push({
                        id: op.id,
                        name: op.name,
                        hours: hours,
                        department: op.department
                    });
                });
            });
        });

        const arr = Array.from(actMap.values()).sort((a, b) => b.totalHours - a.totalHours);
        // Sort operators within each activity by hours
        arr.forEach(a => {
            a.operators.sort((o1, o2) => o2.hours - o1.hours);
        });

        return arr;
    }, [data]);

    const chartData = useMemo(() => {
        return activities.slice(0, 10).map(a => ({
            name: a.name.length > 20 ? a.name.substring(0, 20) + '...' : a.name,
            fullName: a.name,
            Horas: Number(a.totalHours.toFixed(2))
        }));
    }, [activities]);

    const formatHours = (h: number) => {
        const hrs = Math.floor(h);
        const mins = Math.round((h - hrs) * 60);
        return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
    };

    const mostImpactfulActivity = activities[0] || null;

    return (
        <div className="space-y-6">
            {/* Key Metrics row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-red-600 to-orange-600 p-6 rounded-2xl shadow-lg shadow-orange-500/20 text-white relative overflow-hidden">
                    <div className="absolute right-0 bottom-0 opacity-10">
                        <Target className="w-40 h-40 -mr-10 -mb-10" />
                    </div>
                    <p className="font-bold text-white/70 uppercase tracking-widest text-xs mb-2">Pérdida Principal</p>
                    <h3 className="text-3xl font-black leading-tight mb-2">
                        {mostImpactfulActivity ? mostImpactfulActivity.name : 'N/A'}
                    </h3>
                    <div className="flex items-center gap-3">
                        <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-bold backdrop-blur-sm">
                            {mostImpactfulActivity ? formatHours(mostImpactfulActivity.totalHours) : '0h 00m'}
                        </span>
                        <span className="text-white/80 text-sm">
                            {mostImpactfulActivity ? `${mostImpactfulActivity.operators.length} operarios` : ''}
                        </span>
                    </div>
                </div>

                <div className="bg-white p-6 justify-center flex flex-col rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 bg-slate-50 w-24 h-24 rounded-full opacity-50"></div>
                    <p className="font-bold text-slate-400 uppercase tracking-widest text-xs mb-2 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-500" />
                        Total Tipologías
                    </p>
                    <p className="text-4xl font-black text-slate-800">{activities.length}</p>
                    <p className="text-slate-500 text-sm mt-1">Motivos de improductividad detectados</p>
                </div>

                <div className="bg-white p-6 justify-center flex flex-col rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="absolute -right-4 -bottom-4 bg-indigo-50 w-24 h-24 rounded-full opacity-50"></div>
                    <p className="font-bold text-indigo-400 uppercase tracking-widest text-xs mb-2 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Media por Actividad
                    </p>
                    <p className="text-4xl font-black text-slate-800">
                        {activities.length > 0 ? formatHours(activities.reduce((sum, a) => sum + a.totalHours, 0) / activities.length) : '0h 00m'}
                    </p>
                    <p className="text-slate-500 text-sm mt-1">Tiempo de pérdida promedio</p>
                </div>
            </div>

            {/* Top 10 Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <Target className="text-red-500 w-5 h-5" />
                    Top 10 Motivos de Improductividad
                </h3>
                <div className="w-full h-[350px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                            <XAxis
                                type="number"
                                tick={{ fontSize: 12, fill: '#64748b' }}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={(val) => `${val}h`}
                            />
                            <YAxis
                                dataKey="name"
                                type="category"
                                width={150}
                                tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
                                tickLine={false}
                                axisLine={false}
                            />
                            <Tooltip
                                cursor={{ fill: 'rgba(239, 68, 68, 0.05)' }}
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                                formatter={(value: any) => [`${value} horas`, 'Pérdida']}
                                labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
                            />
                            <Bar dataKey="Horas" radius={[0, 6, 6, 0]} barSize={24}>
                                {chartData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={index < 3 ? '#ef4444' : '#f97316'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Detailed Activity List */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="font-bold text-slate-800">Catálogo de Incidencias</h3>
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Buscar motivo..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none w-64 transition-all"
                        />
                    </div>
                </div>

                <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {activities.filter(a => a.name.toLowerCase().includes(searchTerm.toLowerCase())).map((activity, idx) => {
                        const isExpanded = expandedActivity === activity.id;
                        const isTop3 = idx < 3;

                        return (
                            <div key={activity.id} className={`border rounded-xl transition-all ${isExpanded ? 'border-orange-200 shadow-md ring-2 ring-orange-50'
                                : isTop3 ? 'border-red-100 bg-red-50/10 hover:border-red-200'
                                    : 'border-slate-100 hover:border-slate-200 hover:shadow-sm'
                                }`}>
                                <div
                                    className="p-4 cursor-pointer flex items-center justify-between"
                                    onClick={() => setExpandedActivity(isExpanded ? null : activity.id)}
                                >
                                    <div className="flex items-start gap-4 flex-1 pr-4">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 font-bold text-xs ${isTop3 ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'
                                            }`}>
                                            #{idx + 1}
                                        </div>
                                        <div>
                                            <h4 className={`font-bold leading-tight ${isTop3 ? 'text-slate-800' : 'text-slate-700'}`}>
                                                {activity.name}
                                            </h4>
                                            <p className="text-[11px] font-bold text-slate-400 mt-1 flex items-center gap-3 uppercase tracking-wider">
                                                <span>CÓDIGO: {activity.id === 'unknown' ? 'S/C' : activity.id}</span>
                                                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {activity.operators.length}</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-4 text-right shrink-0">
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Total</p>
                                            <p className={`font-black text-lg ${isTop3 ? 'text-red-500' : 'text-slate-700'}`}>
                                                {formatHours(activity.totalHours)}
                                            </p>
                                        </div>
                                        <div className="text-slate-400 w-5 flex justify-center">
                                            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Operator List */}
                                {isExpanded && (
                                    <div className="border-t border-slate-100 bg-slate-50/50 p-4 rounded-b-xl">
                                        <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                            Operarios Afectados <span className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-full text-[9px]">{activity.operators.length}</span>
                                        </h5>
                                        <div className="space-y-2 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                                            {activity.operators.map((op, i) => (
                                                <div key={`${op.id}-${i}`} className="flex justify-between items-center bg-white p-2.5 rounded-lg border border-slate-100 shadow-sm">
                                                    <div className="flex flex-col">
                                                        <span className="font-bold text-sm text-slate-700">{op.name}</span>
                                                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">{op.department}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-md text-sm border border-orange-100">
                                                            {formatHours(op.hours)}
                                                        </span>
                                                        <div className="w-full bg-slate-100 h-1 mt-1.5 rounded-full overflow-hidden">
                                                            <div
                                                                className="bg-orange-400 h-full"
                                                                style={{ width: `${Math.min(100, (op.hours / activity.totalHours) * 100)}%` }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {activities.length === 0 && (
                        <div className="col-span-full py-12 text-center text-slate-400 italic">
                            No se encontraron actividades improductivas.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

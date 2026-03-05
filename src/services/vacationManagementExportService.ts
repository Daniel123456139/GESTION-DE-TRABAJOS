import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { RawDataRow, User } from '../types';
import { logError } from '../utils/logger';

export interface VacationManagementRow {
    operario: string;
    diasSueltos: string;
    periodo1: string;
    periodo2: string;
    periodo3: string;
    derechoYDisfrute: number;
    quedan: number;
}

const formatDate = (dateStr: string): string => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
};

const isConsecutiveWeek = (dates: string[]): boolean => {
    if (dates.length !== 5) return false;
    const sorted = [...dates].sort();
    for (let i = 0; i < 4; i++) {
        const d1 = new Date(sorted[i]);
        const d2 = new Date(sorted[i + 1]);
        const diff = (d2.getTime() - d1.getTime()) / (1000 * 3600 * 24);
        if (diff !== 1) return false;
    }

    const first = new Date(sorted[0]);
    return first.getDay() === 1;
};

export const exportVacationManagementToXlsx = (
    erpData: RawDataRow[],
    targetEmployees: User[],
    year: number = 2026
): void => {
    void (async () => {
        const p1Start = `${year}-08-03`;
        const p1End = `${year}-08-07`;
        const p2Start = `${year}-08-24`;
        const p2End = `${year}-08-28`;

        const data: VacationManagementRow[] = targetEmployees.map((emp) => {
            const empVacDates = erpData
                .filter((r) =>
                    r.IDOperario === emp.id
                    && (r.MotivoAusencia === 5 || r.MotivoAusencia === 8)
                    && r.Fecha.startsWith(year.toString())
                )
                .map((r) => r.Fecha)
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort();

            let p1 = '';
            let p2 = '';
            let p3 = '';
            const usedInPeriods = new Set<string>();

            const p1Dates = empVacDates.filter((d) => d >= p1Start && d <= p1End);
            if (p1Dates.length === 5) {
                p1 = `${formatDate(p1Start)} - ${formatDate(p1End)}`;
                p1Dates.forEach((d) => usedInPeriods.add(d));
            }

            const p2Dates = empVacDates.filter((d) => d >= p2Start && d <= p2End);
            if (p2Dates.length === 5) {
                p2 = `${formatDate(p2Start)} - ${formatDate(p2End)}`;
                p2Dates.forEach((d) => usedInPeriods.add(d));
            }

            const remainingForP3 = empVacDates.filter((d) => !usedInPeriods.has(d));
            for (let i = 0; i <= remainingForP3.length - 5; i++) {
                const window = remainingForP3.slice(i, i + 5);
                if (isConsecutiveWeek(window)) {
                    p3 = `${formatDate(window[0])} - ${formatDate(window[4])}`;
                    window.forEach((d) => usedInPeriods.add(d));
                    break;
                }
            }

            const sueltos = empVacDates.filter((d) => !usedInPeriods.has(d));
            const sueltosStr = sueltos.map(formatDate).join('\n');

            const derecho = 12;
            const consumidos = empVacDates.length;
            const quedan = Math.max(0, derecho - consumidos);

            return {
                operario: `FV${emp.id.toString().padStart(3, '0')} - ${emp.name}`,
                diasSueltos: sueltosStr,
                periodo1: p1,
                periodo2: p2,
                periodo3: p3,
                derechoYDisfrute: derecho,
                quedan
            };
        });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Gestion Vacaciones');

        worksheet.columns = [
            { header: 'OPERARIO', key: 'operario', width: 35 },
            { header: 'DIAS SUELTOS', key: 'diasSueltos', width: 22 },
            { header: 'PERIODO 1', key: 'periodo1', width: 25 },
            { header: 'PERIODO 2', key: 'periodo2', width: 25 },
            { header: 'PERIODO 3', key: 'periodo3', width: 25 },
            { header: 'DIAS DERECHO Y DISFRUTE', key: 'derechoYDisfrute', width: 25 },
            { header: 'DIAS QUE QUEDAN', key: 'quedan', width: 20 }
        ];

        data.forEach((row) => {
            worksheet.addRow(row);
        });

        worksheet.getRow(1).font = { bold: true };
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            row.alignment = { vertical: 'top', wrapText: true };
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        saveAs(blob, `Gestion_Vacaciones_${year}.xlsx`);
    })().catch((error) => {
        logError('Error exportando gestion de vacaciones:', error);
    });
};

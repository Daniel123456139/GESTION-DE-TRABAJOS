import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { ProcessedDataRow, RawDataRow } from '../../types';
import { logError } from '../../utils/logger';

export const exportUnproductivityToXlsx = (
    datasetResumen: ProcessedDataRow[],
    _erpData: RawDataRow[],
    startDate: string,
    endDate: string
): void => {
    void (async () => {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Resumen Improductividad');

        const keys = Object.keys(datasetResumen[0] || {});
        if (!keys.length) {
            worksheet.addRow(['Sin datos para exportar']);
        } else {
            worksheet.columns = keys.map((key) => ({ header: key, key, width: 24 }));
            datasetResumen.forEach((row) => {
                const normalizedRow: Record<string, string | number | boolean | null> = {};
                keys.forEach((key) => {
                    const value = (row as Record<string, unknown>)[key];
                    if (value === null || value === undefined) {
                        normalizedRow[key] = null;
                    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                        normalizedRow[key] = value;
                    } else {
                        normalizedRow[key] = JSON.stringify(value);
                    }
                });
                worksheet.addRow(normalizedRow);
            });
            worksheet.getRow(1).font = { bold: true };
            worksheet.views = [{ state: 'frozen', ySplit: 1 }];
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        saveAs(blob, `Resumen_Improductividad_${startDate}_${endDate}.xlsx`);
    })().catch((error) => {
        logError('Error exportando improductividad a Excel:', error);
    });
};

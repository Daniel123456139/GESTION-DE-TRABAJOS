import { ProcessedDataRow, RawDataRow } from '../../types';
import * as XLSX from 'xlsx';

export const exportUnproductivityToXlsx = (
    datasetResumen: ProcessedDataRow[],
    erpData: RawDataRow[],
    startDate: string,
    endDate: string
) => {
    // Basic implementation to satisfy type checker and provide functionality
    const wb = XLSX.utils.book_new();

    // Create worksheet from data
    const ws = XLSX.utils.json_to_sheet(datasetResumen);
    XLSX.utils.book_append_sheet(wb, ws, "Resumen Improductividad");

    // Generate file
    XLSX.writeFile(wb, `Resumen_Improductividad_${startDate}_${endDate}.xlsx`);
};

import ExcelJS from 'exceljs';

const EXCEL_PATH = 'C:/-- APLICACIONES DANI --/APP -- PRESENCIA/docs/jm.gomez_2026-02-05_07-20-38.xlsx';

const toColumnLetter = (index: number): string => {
    let col = index + 1;
    let result = '';

    while (col > 0) {
        const rem = (col - 1) % 26;
        result = String.fromCharCode(65 + rem) + result;
        col = Math.floor((col - 1) / 26);
    }

    return result;
};

const normalizeValue = (value: ExcelJS.CellValue | null | undefined): unknown => {
    if (value === null || value === undefined) return null;

    if (typeof value === 'object') {
        if ('result' in value) return normalizeValue(value.result as ExcelJS.CellValue);
        if ('text' in value && typeof value.text === 'string') return value.text;
        if ('richText' in value && Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text || '').join('');
        }
    }

    return value;
};

console.log('Analizando Excel real...\n');

try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);

    console.log('Hojas disponibles:', workbook.worksheets.map((ws) => ws.name).join(', '));

    const worksheet = workbook.getWorksheet('BASE DATOS');
    if (!worksheet) {
        console.error('No se encontro hoja "BASE DATOS"');
        process.exit(1);
    }

    console.log(`Rango del Excel: Filas 1 a ${worksheet.rowCount}, Columnas 0 a ${worksheet.columnCount}\n`);

    const getCellValue = (row: number, col: number): unknown => {
        return normalizeValue(worksheet.getRow(row + 1).getCell(col + 1).value);
    };

    const row44 = 43;
    console.log('CONTENIDO COMPLETO DE LA FILA 44:\n');

    for (let col = 0; col <= worksheet.columnCount; col++) {
        const value = getCellValue(row44, col);
        if (value !== null && value !== undefined && value !== '') {
            const colLetter = toColumnLetter(col);
            console.log(`   ${colLetter} (${col}): ${JSON.stringify(value)}`);
        }
    }

    console.log('\nCONTENIDO DE FILAS 44-48:\n');

    const KEY_COLUMNS = {
        F: 5,
        G: 6,
        H: 7,
        I: 8,
        K: 10,
        N: 13,
        R: 17,
        T: 19,
        V: 21
    };

    for (let row = 43; row < 48; row++) {
        console.log(`\n--- FILA ${row + 1} ---`);
        for (const [letter, colIdx] of Object.entries(KEY_COLUMNS)) {
            const value = getCellValue(row, colIdx);
            console.log(`   ${letter} (${colIdx}): ${JSON.stringify(value)}`);
        }
    }

    console.log('\nAnalisis completado.\n');
} catch (error) {
    console.error('Error:', error);
    process.exit(1);
}

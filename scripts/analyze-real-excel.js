import ExcelJS from 'exceljs';

const EXCEL_PATH = 'C:/-- APLICACIONES DANI --/APP -- PRESENCIA/docs/jm.gomez_2026-02-05_07-20-38.xlsx';

const toColumnLetter = (index) => {
    let col = index + 1;
    let result = '';
    while (col > 0) {
        const rem = (col - 1) % 26;
        result = String.fromCharCode(65 + rem) + result;
        col = Math.floor((col - 1) / 26);
    }
    return result;
};

const normalizeValue = (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') {
        if ('result' in value) return normalizeValue(value.result);
        if ('text' in value) return value.text;
        if ('richText' in value) return value.richText.map((part) => part.text || '').join('');
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

    const getCellValue = (row, col) => normalizeValue(worksheet.getRow(row + 1).getCell(col + 1).value);

    console.log('ENCABEZADOS (fila 43):\n');
    for (let col = 0; col <= 25; col++) {
        const value = getCellValue(42, col);
        if (value) {
            const colLetter = toColumnLetter(col);
            console.log(`   ${colLetter} (indice ${col}): "${value}"`);
        }
    }

    const ROW_44 = 43;
    console.log('\nCONTENIDO COMPLETO DE LA FILA 44:\n');
    for (let col = 0; col <= 25; col++) {
        const value = getCellValue(ROW_44, col);
        if (value !== null && value !== undefined && value !== '') {
            const colLetter = toColumnLetter(col);
            console.log(`   ${colLetter} (indice ${col}): ${JSON.stringify(value)}`);
        }
    }

    console.log('\nPRIMERAS 5 FILAS DE DATOS (44-48):\n');

    const KEY_COLUMNS = [
        { letter: 'F', idx: 5, name: 'ARTICULO' },
        { letter: 'G', idx: 6, name: 'DESCRIPCION' },
        { letter: 'H', idx: 7, name: 'CLIENTE' },
        { letter: 'I', idx: 8, name: 'FECHA_REQUERIDA' },
        { letter: 'K', idx: 10, name: 'CANTIDAD' },
        { letter: 'N', idx: 13, name: 'PEDIDO' },
        { letter: 'R', idx: 17, name: 'BIN' },
        { letter: 'T', idx: 19, name: 'FASE_R' },
        { letter: 'V', idx: 21, name: 'LANZ' }
    ];

    for (let row = 43; row < 48; row++) {
        console.log(`\n--- FILA ${row + 1} ---`);
        KEY_COLUMNS.forEach(({ letter, idx, name }) => {
            const value = getCellValue(row, idx);
            console.log(`   ${letter} (${name}): ${JSON.stringify(value)}`);
        });
    }

    console.log('\nAnalisis completado.\n');
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}

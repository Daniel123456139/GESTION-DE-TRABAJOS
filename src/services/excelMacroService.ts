/**
 * SERVICIO DE MACROS EXCEL (Reimplementacion JS de las macros VBA)
 *
 * Flujo aplicado:
 * 1) MACRO ANALISIS INICIAL
 *    - Siempre trabaja con la primera hoja del libro (cualquier nombre).
 *    - Construye AGRUPACION ARTICULOS, HOJA FABRICA y HOJA FINAL.
 *    - Replica reglas de IdPadre, sumas y filtrado de fabricacion.
 *
 * 2) MACRO SECCIONES
 *    - Lee HOJA FINAL y crea SIN SECCION + hojas por seccion.
 *    - Replica agrupaciones VBA: CORTE(LAS/AUT/PUN), PRENSAS(PRE/INS), PLEGADORA(ROB/PLE).
 */

import ExcelJS from 'exceljs';
import { PriorityArticle } from '../types';

const MAX_EXCEL_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXCEL_EXTENSIONS = ['.xlsx', '.xlsm'];

export interface MacroSheet {
    rows: any[][];
    dateColumns: number[];
    columnWidths: number[];
}

export interface MacroWorkbook {
    SheetNames: string[];
    Sheets: Record<string, MacroSheet>;
}

function validateWorkbookInputFile(file: File): void {
    if (!file) throw new Error('No se ha proporcionado ningun archivo.');

    const fileName = file.name.toLowerCase();
    const hasAllowedExtension = ALLOWED_EXCEL_EXTENSIONS.some((ext) => fileName.endsWith(ext));
    if (!hasAllowedExtension) {
        throw new Error('Formato no permitido. Solo se admiten .xlsx o .xlsm.');
    }

    if (file.size <= 0) {
        throw new Error('El archivo esta vacio.');
    }

    if (file.size > MAX_EXCEL_SIZE_BYTES) {
        throw new Error('El archivo excede el tamano maximo permitido (8 MB).');
    }
}

interface SourceRow {
    colA: string;
    articulo: string;
    values: any[];
}

interface ArticleAggregate {
    firstValues: any[];
    count: number;
    sumPedida: number;
    sumLanzada: number;
    sumPendiente: number;
    stock: number;
    phaseSet: Set<string>;
    phases: string[];
    orderSet: Set<string>;
    orders: string[];
    nearestFutureDate: Date | null;
}

const SECTION_GROUPS = new Map<string, Set<string>>([
    ['CORTE', new Set(['LAS', 'AUT', 'PUN'])],
    ['PRENSAS', new Set(['PRE', 'INS'])],
    ['PLEGADORA', new Set(['ROB', 'PLE'])]
]);

function normalizeExcelCellValue(value: ExcelJS.CellValue | null | undefined): any {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

    if (typeof value === 'object') {
        if ('result' in value) return normalizeExcelCellValue(value.result as ExcelJS.CellValue);
        if ('text' in value && typeof value.text === 'string') return value.text;
        if ('richText' in value && Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text || '').join('');
        }
        if ('hyperlink' in value && typeof value.hyperlink === 'string') {
            return value.text || value.hyperlink;
        }
        if ('formula' in value) return null;
        if ('error' in value) return null;
    }

    return String(value);
}

function worksheetToRows(worksheet: ExcelJS.Worksheet): any[][] {
    const rows: any[][] = [];
    const maxRow = worksheet.rowCount;

    for (let r = 1; r <= maxRow; r++) {
        const row = worksheet.getRow(r);
        const values: any[] = [];
        for (let c = 1; c <= row.cellCount; c++) {
            values.push(normalizeExcelCellValue(row.getCell(c).value));
        }
        rows.push(values);
    }

    return rows;
}

function cellVal(ws: MacroSheet, row: number, col: number): any {
    return ws.rows[row]?.[col] ?? null;
}

function normalizeText(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function excelSerialToDate(serial: number): Date | null {
    if (!Number.isFinite(serial)) return null;
    const excelEpoch = Date.UTC(1899, 11, 30);
    const utc = new Date(excelEpoch + (serial * 86400000));
    if (isNaN(utc.getTime())) return null;
    return new Date(
        utc.getUTCFullYear(),
        utc.getUTCMonth(),
        utc.getUTCDate(),
        utc.getUTCHours(),
        utc.getUTCMinutes(),
        utc.getUTCSeconds()
    );
}

function parseDate(value: any): Date | null {
    if (!value) return null;

    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number') {
        return excelSerialToDate(value);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;

        const esMatch = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
        if (esMatch) {
            const day = Number(esMatch[1]);
            const month = Number(esMatch[2]);
            const yearRaw = Number(esMatch[3]);
            const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
            const candidate = new Date(year, month - 1, day);
            if (!isNaN(candidate.getTime())) return candidate;
        }

        const candidate = new Date(trimmed);
        return isNaN(candidate.getTime()) ? null : candidate;
    }

    return null;
}

function toNum(value: any): number {
    if (value === null || value === undefined || value === '') return 0;
    const cleaned = typeof value === 'string' ? value.replace(/\+/g, '').trim() : value;
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function hasIdPadreMarker(value: string): boolean {
    return value.toLowerCase().includes('idpadre:');
}

function extractAfterColon(value: string): string {
    const idx = value.indexOf(':');
    if (idx === -1) return '';
    return value.slice(idx + 1).trim();
}

function splitCommaValues(value: string): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
}

function sanitizeSheetName(name: string): string {
    const cleaned = name.replace(/[\\/*\[\]:?]/g, ' ').trim();
    const safe = cleaned || 'SECCION';
    return safe.slice(0, 31);
}

function computeColumnWidths(data: any[][]): Array<{ wch: number }> {
    if (!data.length) return [];

    const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0);
    const widths: Array<{ wch: number }> = [];

    for (let c = 0; c < maxCols; c++) {
        let maxLen = 10;
        for (let r = 0; r < data.length; r++) {
            const value = data[r][c];
            const text = value instanceof Date ? 'dd/mm/yyyy' : normalizeText(value);
            maxLen = Math.max(maxLen, text.length + 2);
        }
        widths.push({ wch: Math.min(maxLen, 70) });
    }

    return widths;
}

function applySheetLayout(sheet: MacroSheet, data: any[][], dateColumns: number[]): void {
    if (!data.length) return;

    sheet.columnWidths = computeColumnWidths(data).map((col) => col.wch);
    sheet.dateColumns = [...dateColumns];

    for (let r = 1; r < data.length; r++) {
        for (const dateCol of dateColumns) {
            const dateValue = parseDate(data[r][dateCol]);
            if (dateValue) data[r][dateCol] = dateValue;
        }
    }
}

function upsertSheet(wb: MacroWorkbook, name: string, data: any[][], dateColumns: number[]): void {
    const safeName = sanitizeSheetName(name);

    if (wb.Sheets[safeName]) {
        delete wb.Sheets[safeName];
        wb.SheetNames = wb.SheetNames.filter((sheetName) => sheetName !== safeName);
    }

    const rows = data.map((row) => [...row]);
    const sheet: MacroSheet = {
        rows,
        dateColumns: [],
        columnWidths: []
    };
    applySheetLayout(sheet, rows, dateColumns);
    wb.Sheets[safeName] = sheet;
    wb.SheetNames.push(safeName);
}

function sortRowsByDate(rows: any[][]): any[][] {
    return [...rows].sort((a, b) => {
        const dateA = parseDate(a[2]);
        const dateB = parseDate(b[2]);

        if (dateA && dateB) return dateA.getTime() - dateB.getTime();
        if (dateA && !dateB) return -1;
        if (!dateA && dateB) return 1;
        return 0;
    });
}

function runMacroAnalisisInicial(wb: MacroWorkbook): void {
    const firstSheetName = wb.SheetNames[0];
    const wsOriginal = wb.Sheets[firstSheetName];

    if (!wsOriginal || !wsOriginal.rows.length) {
        throw new Error('El archivo no contiene hoja de origen para ejecutar macros.');
    }

    const totalRows = wsOriginal.rows.length;
    const totalCols = wsOriginal.rows.reduce((max, row) => Math.max(max, row.length), 0);
    if (totalCols === 0) {
        throw new Error('La hoja de origen no contiene columnas validas.');
    }

    const headers = Array.from({ length: totalCols }, (_, c) => cellVal(wsOriginal, 0, c) ?? '');

    const sourceRows: SourceRow[] = [];
    for (let r = 1; r < totalRows; r++) {
        const values = Array.from({ length: totalCols }, (_, c) => cellVal(wsOriginal, r, c));
        sourceRows.push({
            colA: normalizeText(values[0]),
            articulo: normalizeText(values[1]),
            values
        });
    }

    const childToParent = new Map<string, string>();
    const parentDates = new Map<string, Date>();

    let currentParent = '';
    let insideParentGroup = false;

    for (const row of sourceRows) {
        if (row.colA && hasIdPadreMarker(row.colA)) {
            currentParent = extractAfterColon(row.colA);
            insideParentGroup = currentParent !== '';
        }

        if (!insideParentGroup || !currentParent || !row.articulo) continue;

        if (row.articulo === currentParent) {
            const parentDate = parseDate(row.values[3]);
            if (parentDate) parentDates.set(currentParent, parentDate);
            continue;
        }

        if (!childToParent.has(row.articulo)) {
            childToParent.set(row.articulo, currentParent);
        }
    }

    const aggregates = new Map<string, ArticleAggregate>();
    const articleOrder: string[] = [];
    const launchedOrdersSeen = new Set<string>();
    const today = startOfDay(new Date());

    for (const row of sourceRows) {
        if (!row.articulo) continue;

        const articulo = row.articulo;
        const nOrden = normalizeText(row.values[9]);
        const phasesRaw = normalizeText(row.values[8]);

        let fecha = parseDate(row.values[3]);
        if (!fecha) {
            const parent = childToParent.get(articulo);
            if (parent && parentDates.has(parent)) fecha = parentDates.get(parent) || null;
        }

        let agg = aggregates.get(articulo);
        if (!agg) {
            agg = {
                firstValues: [...row.values],
                count: 0,
                sumPedida: 0,
                sumLanzada: 0,
                sumPendiente: 0,
                stock: toNum(row.values[6]),
                phaseSet: new Set<string>(),
                phases: [],
                orderSet: new Set<string>(),
                orders: [],
                nearestFutureDate: null
            };
            aggregates.set(articulo, agg);
            articleOrder.push(articulo);
        }

        agg.count += 1;
        agg.sumPedida += toNum(row.values[4]);
        agg.sumPendiente += toNum(row.values[7]);

        if (nOrden) {
            const orderKey = `${articulo}|${nOrden}`;
            if (!launchedOrdersSeen.has(orderKey)) {
                launchedOrdersSeen.add(orderKey);
                agg.sumLanzada += toNum(row.values[5]);
            }

            if (!agg.orderSet.has(nOrden)) {
                agg.orderSet.add(nOrden);
                agg.orders.push(nOrden);
            }
        }

        for (const phase of splitCommaValues(phasesRaw)) {
            if (agg.phaseSet.has(phase)) continue;
            agg.phaseSet.add(phase);
            agg.phases.push(phase);
        }

        if (fecha && startOfDay(fecha).getTime() >= today.getTime()) {
            if (!agg.nearestFutureDate || fecha < agg.nearestFutureDate) {
                agg.nearestFutureDate = fecha;
            }
        }
    }

    const agrupacionRows: any[][] = [];

    for (const articulo of articleOrder) {
        const agg = aggregates.get(articulo);
        if (!agg) continue;

        const outRow = [...agg.firstValues];

        if (hasIdPadreMarker(normalizeText(outRow[0]))) continue;

        if (agg.count > 1) {
            outRow[4] = agg.sumPedida;
            outRow[5] = agg.sumLanzada;
            outRow[7] = agg.sumPendiente;
        }

        outRow[6] = agg.stock;
        outRow[8] = agg.phases.join(',');
        outRow[9] = agg.orders.join(',');

        if (agg.nearestFutureDate) {
            outRow[3] = agg.nearestFutureDate;
        } else if (!parseDate(outRow[3])) {
            const parent = childToParent.get(articulo);
            if (parent && parentDates.has(parent)) {
                outRow[3] = parentDates.get(parent);
            }
        }

        outRow[1] = normalizeText(outRow[1]);
        outRow[9] = normalizeText(outRow[9]);

        agrupacionRows.push(outRow);
    }

    const noFabricar = new Set<string>();
    const reviewedParents = new Set<string>();

    for (let i = 0; i < sourceRows.length; i++) {
        const row = sourceRows[i];
        if (!hasIdPadreMarker(row.colA)) continue;

        const parentCode = extractAfterColon(row.colA);
        if (!parentCode || reviewedParents.has(parentCode)) continue;

        reviewedParents.add(parentCode);

        let groupEnd = i;
        for (let j = i + 1; j < sourceRows.length; j++) {
            if (hasIdPadreMarker(sourceRows[j].colA)) break;
            groupEnd = j;
        }

        const parentAgg = aggregates.get(parentCode);
        const parentCovered = !!parentAgg && parentAgg.stock >= parentAgg.sumPedida;

        if (parentCovered) {
            noFabricar.add(parentCode);
            for (let k = i + 1; k <= groupEnd; k++) {
                const childArt = sourceRows[k].articulo;
                if (childArt && childArt !== parentCode) {
                    noFabricar.add(childArt);
                }
            }
        }

        i = groupEnd;
    }

    const fabricaRows = agrupacionRows.filter((row) => {
        const articulo = normalizeText(row[1]);
        if (!articulo) return false;

        const pendiente = toNum(row[7]);
        const stock = toNum(row[6]);
        return pendiente > stock && !noFabricar.has(articulo);
    });

    const pickHeader = (index: number, fallback: string) => normalizeText(headers[index]) || fallback;

    const hojaFinalHeaders = [
        pickHeader(1, 'Articulo'),
        pickHeader(2, 'Desc. Articulo'),
        pickHeader(3, 'Fecha Entrega'),
        pickHeader(7, 'C.Pendiente'),
        pickHeader(5, 'C.Lanzada'),
        pickHeader(6, 'Stock'),
        pickHeader(8, 'CFases'),
        pickHeader(9, 'NOrden')
    ];

    const hojaFinalRows = fabricaRows.map((row) => ([
        normalizeText(row[1]),
        normalizeText(row[2]),
        parseDate(row[3]) || row[3] || '',
        toNum(row[7]),
        toNum(row[5]),
        toNum(row[6]),
        normalizeText(row[8]),
        normalizeText(row[9])
    ]));

    upsertSheet(wb, 'AGRUPACION ARTICULOS', [headers, ...agrupacionRows], [3]);
    upsertSheet(wb, 'HOJA FABRICA', [headers, ...fabricaRows], [3]);
    upsertSheet(wb, 'HOJA FINAL', [hojaFinalHeaders, ...hojaFinalRows], [2]);
}

function runMacroSecciones(wb: MacroWorkbook): void {
    const wsFinal = wb.Sheets['HOJA FINAL'];
    if (!wsFinal) return;

    const finalData = wsFinal.rows.map((row) => [...row]);

    if (finalData.length <= 1) {
        const defaultHeaders = ['Articulo', 'Desc. Articulo', 'Fecha Entrega', 'C.Pendiente', 'C.Lanzada', 'Stock', 'CFases', 'NOrden'];
        upsertSheet(wb, 'SIN SECCION', [defaultHeaders], [2]);
        for (const groupName of SECTION_GROUPS.keys()) {
            upsertSheet(wb, groupName, [defaultHeaders], [2]);
        }
        return;
    }

    const headers = [...(finalData[0] || [])].slice(0, 8);
    while (headers.length < 8) headers.push('');

    const rows = finalData.slice(1).map((row) => {
        const normalized = [...row].slice(0, 8);
        while (normalized.length < 8) normalized.push('');
        return normalized;
    });

    const sinSeccionRows: any[][] = [];
    const sectionRowIndexes = new Map<string, Set<number>>();
    const dynamicSectionOrder: string[] = [];

    for (const groupName of SECTION_GROUPS.keys()) {
        sectionRowIndexes.set(groupName, new Set<number>());
    }

    rows.forEach((row, rowIndex) => {
        const sectionText = normalizeText(row[6]);
        if (!sectionText) {
            sinSeccionRows.push(row);
            return;
        }

        const tokens = splitCommaValues(sectionText).map((token) => token.toUpperCase());
        if (!tokens.length) {
            sinSeccionRows.push(row);
            return;
        }

        const assignedSections = new Set<string>();

        for (const token of tokens) {
            let sectionName = token;

            for (const [groupName, sectionCodes] of SECTION_GROUPS.entries()) {
                if (sectionCodes.has(token)) {
                    sectionName = groupName;
                    break;
                }
            }

            assignedSections.add(sectionName);
        }

        for (const sectionName of assignedSections) {
            if (!sectionRowIndexes.has(sectionName)) {
                sectionRowIndexes.set(sectionName, new Set<number>());
                dynamicSectionOrder.push(sectionName);
            }
            sectionRowIndexes.get(sectionName)?.add(rowIndex);
        }
    });

    if (sinSeccionRows.length > 0) {
        upsertSheet(wb, 'SIN SECCION', [headers, ...sortRowsByDate(sinSeccionRows)], [2]);
    }

    for (const groupName of SECTION_GROUPS.keys()) {
        const indexes = sectionRowIndexes.get(groupName) || new Set<number>();
        const sectionRows = Array.from(indexes).map((index) => rows[index]);
        upsertSheet(wb, groupName, [headers, ...sortRowsByDate(sectionRows)], [2]);
    }

    for (const dynamicSection of dynamicSectionOrder) {
        const indexes = sectionRowIndexes.get(dynamicSection);
        if (!indexes || indexes.size === 0) continue;
        const sectionRows = Array.from(indexes).map((index) => rows[index]);
        upsertSheet(wb, dynamicSection, [headers, ...sortRowsByDate(sectionRows)], [2]);
    }
}

export async function applyMacrosToWorkbook(file: File): Promise<MacroWorkbook> {
    validateWorkbookInputFile(file);

    try {
        const buffer = await file.arrayBuffer();
        const inputWorkbook = new ExcelJS.Workbook();
        await inputWorkbook.xlsx.load(buffer);

        const firstSheet = inputWorkbook.worksheets[0];
        if (!firstSheet) {
            throw new Error('El archivo no contiene hojas.');
        }

        const firstSheetName = sanitizeSheetName(firstSheet.name || 'ORIGEN');
        const firstRows = worksheetToRows(firstSheet);
        const firstSheetWidths = computeColumnWidths(firstRows).map((col) => col.wch);

        const wb: MacroWorkbook = {
            SheetNames: [firstSheetName],
            Sheets: {
                [firstSheetName]: {
                    rows: firstRows,
                    dateColumns: [],
                    columnWidths: firstSheetWidths
                }
            }
        };

        runMacroAnalisisInicial(wb);
        runMacroSecciones(wb);

        return wb;
    } catch (error) {
        throw new Error(`Error procesando macros: ${(error as Error).message}`);
    }
}

export function extractHojaFinalFromWorkbook(wb: MacroWorkbook): PriorityArticle[] {
    const ws = wb.Sheets['HOJA FINAL'];
    if (!ws) {
        throw new Error('El workbook no contiene la hoja "HOJA FINAL".');
    }

    const articles: PriorityArticle[] = [];

    for (let rowNum = 1; rowNum < ws.rows.length; rowNum++) {
        const articulo = normalizeText(cellVal(ws, rowNum, 0));
        if (!articulo) continue;

        const nOrdenRaw = normalizeText(cellVal(ws, rowNum, 7));
        const nOrdenFirst = nOrdenRaw.split(',')[0]?.trim() || '';

        articles.push({
            articulo,
            descripcion: normalizeText(cellVal(ws, rowNum, 1)),
            fechaRequerida: parseDate(cellVal(ws, rowNum, 2)),
            cantidad: toNum(cellVal(ws, rowNum, 3)),
            stock: toNum(cellVal(ws, rowNum, 5)),
            cliente: '',
            pedido: '',
            bin: 0,
            faseR: normalizeText(cellVal(ws, rowNum, 6)),
            lanz: nOrdenFirst
        });
    }

    return articles;
}

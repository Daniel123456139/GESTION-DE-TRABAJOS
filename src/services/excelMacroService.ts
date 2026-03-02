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

import * as XLSX from 'xlsx';
import { PriorityArticle } from '../types';

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

function cellVal(ws: XLSX.WorkSheet, row: number, col: number): any {
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = ws[addr];
    return cell ? cell.v : null;
}

function normalizeText(value: any): string {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function parseDate(value: any): Date | null {
    if (!value) return null;

    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number') {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
        return new Date(parsed.y, parsed.m - 1, parsed.d);
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
        .map(part => part.trim())
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

function applySheetLayout(ws: XLSX.WorkSheet, data: any[][], dateColumns: number[]): void {
    if (!data.length) return;

    const maxCols = data.reduce((max, row) => Math.max(max, row.length), 0);
    if (maxCols === 0) return;

    ws['!cols'] = computeColumnWidths(data);
    ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(maxCols - 1)}1` };
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

    for (let r = 1; r < data.length; r++) {
        for (const dateCol of dateColumns) {
            const dateValue = parseDate(data[r][dateCol]);
            if (!dateValue) continue;

            const addr = XLSX.utils.encode_cell({ r, c: dateCol });
            const existing = ws[addr] || {};
            ws[addr] = {
                ...existing,
                t: 'd',
                v: dateValue,
                z: 'dd/mm/yyyy'
            };
        }
    }
}

function upsertSheet(wb: XLSX.WorkBook, name: string, data: any[][], dateColumns: number[]): void {
    const safeName = sanitizeSheetName(name);

    if (wb.Sheets[safeName]) {
        delete wb.Sheets[safeName];
        wb.SheetNames = wb.SheetNames.filter(sheetName => sheetName !== safeName);
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    applySheetLayout(ws, data, dateColumns);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
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

function runMacroAnalisisInicial(wb: XLSX.WorkBook): void {
    const firstSheetName = wb.SheetNames[0];
    const wsOriginal = wb.Sheets[firstSheetName];

    if (!wsOriginal) {
        throw new Error('El archivo no contiene hoja de origen para ejecutar macros.');
    }

    const range = XLSX.utils.decode_range(wsOriginal['!ref'] || 'A1');
    const totalRows = range.e.r + 1;
    const totalCols = range.e.c + 1;

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

    // 1) Identificacion de relaciones padre/hijo y fecha del padre
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

    // 2) Agregacion principal (equivalente a AGRUPACION ARTICULOS)
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

    // 3) Regla "no fabricar" por cobertura del padre
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

    // 4) HOJA FABRICA: Pendiente > Stock y no marcado en noFabricar
    const fabricaRows = agrupacionRows.filter(row => {
        const articulo = normalizeText(row[1]);
        if (!articulo) return false;

        const pendiente = toNum(row[7]);
        const stock = toNum(row[6]);
        return pendiente > stock && !noFabricar.has(articulo);
    });

    // 5) HOJA FINAL: mapeo de columnas B,C,D,H,F,G,I,J -> A..H
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

    const hojaFinalRows = fabricaRows.map(row => ([
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

function runMacroSecciones(wb: XLSX.WorkBook): void {
    const wsFinal = wb.Sheets['HOJA FINAL'];
    if (!wsFinal) return;

    const finalData = XLSX.utils.sheet_to_json(wsFinal, {
        header: 1,
        raw: true,
        defval: ''
    }) as any[][];

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

    const rows = finalData.slice(1).map(row => {
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

        const tokens = splitCommaValues(sectionText).map(token => token.toUpperCase());
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
        const sectionRows = Array.from(indexes).map(index => rows[index]);
        upsertSheet(wb, groupName, [headers, ...sortRowsByDate(sectionRows)], [2]);
    }

    for (const dynamicSection of dynamicSectionOrder) {
        const indexes = sectionRowIndexes.get(dynamicSection);
        if (!indexes || indexes.size === 0) continue;
        const sectionRows = Array.from(indexes).map(index => rows[index]);
        upsertSheet(wb, dynamicSection, [headers, ...sortRowsByDate(sectionRows)], [2]);
    }
}

export async function applyMacrosToWorkbook(file: File): Promise<XLSX.WorkBook> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const bytes = new Uint8Array(event.target?.result as ArrayBuffer);
                const inputWb = XLSX.read(bytes, { type: 'array', cellDates: false });

                if (!inputWb.SheetNames.length) {
                    throw new Error('El archivo no contiene hojas.');
                }

                // REQUISITO CLAVE: siempre usar la primera hoja del libro, tenga el nombre que tenga.
                const firstSheetName = inputWb.SheetNames[0];
                const firstSheet = inputWb.Sheets[firstSheetName];

                if (!firstSheet) {
                    throw new Error('No se pudo leer la primera hoja del archivo.');
                }

                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, firstSheet, firstSheetName);

                runMacroAnalisisInicial(wb);
                runMacroSecciones(wb);

                resolve(wb);
            } catch (error) {
                reject(new Error(`Error procesando macros: ${(error as Error).message}`));
            }
        };

        reader.onerror = () => reject(new Error('Error al leer el archivo Excel.'));
        reader.readAsArrayBuffer(file);
    });
}

export function extractHojaFinalFromWorkbook(wb: XLSX.WorkBook): PriorityArticle[] {
    const ws = wb.Sheets['HOJA FINAL'];
    if (!ws) {
        throw new Error('El workbook no contiene la hoja "HOJA FINAL".');
    }

    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const articles: PriorityArticle[] = [];

    for (let rowNum = 1; rowNum <= range.e.r; rowNum++) {
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

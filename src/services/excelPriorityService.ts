/**
 * SERVICIO DE PARSEO Y VALIDACION DE EXCEL
 *
 * Responsabilidad: Leer archivo Excel "LISTADO DE CARGA" y extraer
 * informacion de prioridades de fabricacion.
 *
 * Especificaciones:
 * - Hoja requerida: "BASE DATOS"
 * - Inicio de datos: Fila 44
 * - Columnas criticas: F, H, I, K, L, N, R, T, V
 */

import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { PriorityArticle } from '../types';
import { logError, logInfo, logWarning } from '../utils/logger';
import { MacroWorkbook } from './excelMacroService';

const DEBUG_MODE = false;
const MAX_EXCEL_SIZE_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXCEL_EXTENSIONS = ['.xlsx', '.xlsm'];

const validateInputExcelFile = (file: File, context: string): void => {
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

    if (DEBUG_MODE) {
        logInfo('[Excel Parser] Archivo validado', {
            source: context,
            fileName: file.name,
            size: file.size
        });
    }
};

const COLUMN_INDICES = {
    ARTICULO: 5,
    DESCRIPCION: 6,
    CLIENTE: 7,
    FECHA_REQUERIDA: 8,
    CANTIDAD: 10,
    STOCK: 11,
    PEDIDO: 13,
    BIN: 17,
    FASE_R: 19,
    LANZ: 21
};

const INITIAL_ROW = 44;
const REQUIRED_SHEET = 'BASE DATOS';
const HOJA_FINAL_NAME = 'HOJA FINAL';

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

function parseExcelDateValue(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') return excelSerialToDate(value);
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

        const parsed = new Date(trimmed);
        return isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
}

function parseNumber(value: any): number {
    if (value === null || value === undefined || value === '') {
        return 0;
    }
    const num = Number(value);
    return isNaN(num) ? 0 : num;
}

function getCellValue(worksheet: ExcelJS.Worksheet, row: number, col: number): any {
    const rawValue = worksheet.getRow(row + 1).getCell(col + 1).value;
    const value = normalizeExcelCellValue(rawValue);
    if (typeof value === 'string' && value.length > 5000) {
        return value.slice(0, 5000);
    }
    return value;
}

export async function parseExcelFile(file: File): Promise<PriorityArticle[]> {
    try {
        validateInputExcelFile(file, 'excelPriorityService.parseExcelFile');

        const arrayBuffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);

        if (!validateExcelStructure(workbook)) {
            throw new Error(`El archivo debe contener una hoja llamada "${REQUIRED_SHEET}"`);
        }

        const worksheet = workbook.getWorksheet(REQUIRED_SHEET);
        if (!worksheet) {
            throw new Error(`No se pudo leer la hoja "${REQUIRED_SHEET}".`);
        }

        return extractPriorityData(worksheet);
    } catch (error) {
        throw new Error(`Error al parsear Excel: ${(error as Error).message}`);
    }
}

export function validateExcelStructure(workbook: ExcelJS.Workbook): boolean {
    return !!workbook.getWorksheet(REQUIRED_SHEET);
}

export function extractPriorityData(worksheet: ExcelJS.Worksheet): PriorityArticle[] {
    const articles: PriorityArticle[] = [];
    const totalRows = worksheet.rowCount;

    if (DEBUG_MODE) {
        logInfo('[Excel Parser] Iniciando extraccion', {
            source: 'excelPriorityService.extractPriorityData',
            totalRows,
            initialRow: INITIAL_ROW
        });
    }

    let articulosSinFecha = 0;
    const MAX_ARTICLES = 5000;

    for (let rowNum = INITIAL_ROW - 1; rowNum < totalRows; rowNum++) {
        if (articles.length >= MAX_ARTICLES) {
            logWarning(`Limite alcanzado: se parsearon ${MAX_ARTICLES} articulos. Resto del Excel ignorado.`);
            break;
        }

        try {
            const fechaCellValue = getCellValue(worksheet, rowNum, COLUMN_INDICES.FECHA_REQUERIDA);
            const fechaRequerida = parseExcelDateValue(fechaCellValue);

            const articulo = getCellValue(worksheet, rowNum, COLUMN_INDICES.ARTICULO);
            if (!articulo || articulo.toString().trim() === '') continue;

            if (!fechaRequerida) articulosSinFecha++;

            const article: PriorityArticle = {
                articulo: articulo.toString().trim(),
                cliente: (getCellValue(worksheet, rowNum, COLUMN_INDICES.CLIENTE) || '').toString().trim(),
                descripcion: (getCellValue(worksheet, rowNum, COLUMN_INDICES.DESCRIPCION) || '').toString().trim(),
                fechaRequerida,
                cantidad: parseNumber(getCellValue(worksheet, rowNum, COLUMN_INDICES.CANTIDAD)),
                stock: parseNumber(getCellValue(worksheet, rowNum, COLUMN_INDICES.STOCK)),
                pedido: (getCellValue(worksheet, rowNum, COLUMN_INDICES.PEDIDO) || '').toString().trim(),
                bin: parseNumber(getCellValue(worksheet, rowNum, COLUMN_INDICES.BIN)),
                faseR: (getCellValue(worksheet, rowNum, COLUMN_INDICES.FASE_R) || '').toString().trim(),
                lanz: (getCellValue(worksheet, rowNum, COLUMN_INDICES.LANZ) || '').toString().trim()
            };

            articles.push(article);
        } catch (error) {
            if (DEBUG_MODE) {
                logWarning(`Error parseando fila ${rowNum}:`, error);
            }
        }
    }

    if (DEBUG_MODE) {
        logInfo('[Excel Parser] Extraccion completada', {
            source: 'excelPriorityService.extractPriorityData',
            articlesRead: articles.length,
            articlesWithoutDate: articulosSinFecha,
        });
    }

    return articles;
}

export function isValidExcelFile(file: File): boolean {
    const fileName = file.name.toLowerCase();
    return ALLOWED_EXCEL_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

export async function parseHojaFinalFile(file: File): Promise<PriorityArticle[]> {
    try {
        validateInputExcelFile(file, 'excelPriorityService.parseHojaFinalFile');

        const arrayBuffer = await file.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);

        const worksheet = workbook.getWorksheet(HOJA_FINAL_NAME);
        if (!worksheet) {
            throw new Error(`El archivo no contiene la hoja "${HOJA_FINAL_NAME}". Asegurese de usar un Excel procesado por las macros.`);
        }

        return extractArticlesFromHojaFinal(worksheet);
    } catch (error) {
        throw new Error(`Error al parsear HOJA FINAL: ${(error as Error).message}`);
    }
}

function extractArticlesFromHojaFinal(ws: ExcelJS.Worksheet): PriorityArticle[] {
    const articles: PriorityArticle[] = [];
    const totalRows = ws.rowCount;

    for (let rowNum = 1; rowNum < totalRows; rowNum++) {
        const articulo = getCellValue(ws, rowNum, 0);
        if (!articulo || String(articulo).trim() === '') continue;

        const fechaRequerida = parseExcelDateValue(getCellValue(ws, rowNum, 2));

        const nOrdenRaw = getCellValue(ws, rowNum, 7);
        const lanz = nOrdenRaw ? String(nOrdenRaw).split(',')[0]?.trim() || '' : '';

        const parseFinalNum = (colIdx: number): number => {
            const val = getCellValue(ws, rowNum, colIdx);
            return parseNumber(val);
        };

        articles.push({
            articulo: String(articulo).trim(),
            descripcion: String(getCellValue(ws, rowNum, 1) || '').trim(),
            fechaRequerida,
            cantidad: parseFinalNum(3),
            stock: parseFinalNum(5),
            cliente: '',
            pedido: '',
            bin: 0,
            faseR: String(getCellValue(ws, rowNum, 6) || '').trim(),
            lanz
        });
    }

    if (DEBUG_MODE) {
        logInfo('[HOJA FINAL Parser] Articulos extraidos', {
            source: 'excelPriorityService.extractArticlesFromHojaFinal',
            articles: articles.length
        });
    }

    return articles;
}

function parseDateForExport(value: any): Date | null {
    return parseExcelDateValue(value);
}

function computeColumnWidthFromData(rows: any[][], colIndex: number): number {
    let maxLen = 10;

    for (const row of rows) {
        const value = row[colIndex];
        const text = value instanceof Date ? 'dd/mm/yyyy' : String(value ?? '');
        maxLen = Math.max(maxLen, text.length + 2);
    }

    return Math.min(maxLen, 70);
}

export const exportWorkbookToFile = async (
    workbook: MacroWorkbook,
    fileName: string = 'despues macros.xlsx'
): Promise<void> => {
    try {
        const professionalWb = new ExcelJS.Workbook();
        const sourceFirstSheet = workbook.SheetNames[0];
        const today = new Date();
        const todayAtStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        for (const sheetName of workbook.SheetNames) {
            const sourceSheet = workbook.Sheets[sheetName];
            if (!sourceSheet) continue;

            const rows = sourceSheet.rows || [];
            const targetSheet = professionalWb.addWorksheet(sheetName, {
                views: [{ state: 'frozen', ySplit: 1 }]
            });

            if (!rows.length) continue;

            rows.forEach((row) => targetSheet.addRow(row));

            const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
            if (maxCols === 0) continue;

            targetSheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: maxCols }
            };

            for (let c = 1; c <= maxCols; c++) {
                const sourceWidth = sourceSheet.columnWidths?.[c - 1];
                targetSheet.getColumn(c).width = sourceWidth || computeColumnWidthFromData(rows, c - 1);
            }

            const headerValues = (rows[0] || []).map((header) => String(header || '').toLowerCase());
            const dateColumns = sourceSheet.dateColumns?.length
                ? sourceSheet.dateColumns.map((idx) => idx + 1)
                : headerValues
                    .map((header, idx) => (header.includes('fecha') ? idx + 1 : -1))
                    .filter((idx) => idx > 0);

            for (let r = 1; r <= targetSheet.rowCount; r++) {
                const row = targetSheet.getRow(r);
                row.height = 20;

                for (let c = 1; c <= maxCols; c++) {
                    const cell = row.getCell(c);

                    cell.font = {
                        name: 'Arial',
                        size: 10,
                        bold: r === 1
                    };

                    cell.alignment = {
                        horizontal: 'center',
                        vertical: 'middle',
                        wrapText: r === 1
                    };

                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
                        right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
                    };

                    if (r === 1) {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF0F0F0' }
                        };
                    }
                }
            }

            for (const dateCol of dateColumns) {
                for (let r = 2; r <= targetSheet.rowCount; r++) {
                    const cell = targetSheet.getRow(r).getCell(dateCol);
                    const parsedDate = parseDateForExport(cell.value);
                    if (!parsedDate) continue;

                    cell.value = parsedDate;
                    cell.numFmt = 'dd/mm/yyyy';

                    const diffDays = Math.floor(
                        (
                            new Date(
                                parsedDate.getFullYear(),
                                parsedDate.getMonth(),
                                parsedDate.getDate()
                            ).getTime() - todayAtStart.getTime()
                        ) / (1000 * 60 * 60 * 24)
                    );

                    if (diffDays >= 0 && diffDays <= 5) {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFFC8C8' }
                        };
                        cell.font = {
                            name: 'Arial',
                            size: 10,
                            bold: true,
                            color: { argb: 'FFC80000' }
                        };
                    }
                }
            }

            if (sheetName !== sourceFirstSheet) {
                targetSheet.pageSetup = {
                    orientation: 'landscape',
                    paperSize: 9,
                    fitToPage: true,
                    fitToWidth: 1,
                    fitToHeight: 0,
                    margins: {
                        left: 0.5,
                        right: 0.5,
                        top: 0.75,
                        bottom: 0.75,
                        header: 0.3,
                        footer: 0.3
                    },
                    horizontalCentered: true,
                    verticalCentered: false,
                    printTitlesRow: '1:1',
                    showGridLines: true
                };
            }
        }

        const buffer = await professionalWb.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        saveAs(blob, fileName);
        logInfo('Archivo Excel exportado y descargado', {
            source: 'excelPriorityService.exportWorkbookToFile',
            fileName
        });
    } catch (error) {
        logError('Error al exportar el archivo Excel:', error);
        throw new Error('No se pudo generar el archivo Excel para descarga.');
    }
};

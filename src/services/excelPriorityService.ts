/**
 * SERVICIO DE PARSEO Y VALIDACIÓN DE EXCEL
 * 
 * Responsabilidad: Leer archivo Excel "LISTADO DE CARGA" y extraer
 * información de prioridades de fabricación
 * 
 * Especificaciones:
 * - Hoja requerida: "BASE DATOS"
 * - Inicio de datos: Fila 44
 * - Columnas críticas: F, H, I, K, L, N, R, T, V
 */

import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { PriorityArticle } from '../types';
import { logError, logWarning } from '../utils/logger';

const DEBUG_MODE = false; // Desactivado para evitar ERR_INSUFFICIENT_RESOURCES

/**
 * Índices de columnas en el Excel (base 0)
 * Especificación CORREGIDA según usuario (2026-02-05):
 * 
 * F (5)  = ARTICULO       - Código del artículo a analizar
 * G (6)  = DESCRIPCION    - Descripción del artículo (ASUMIDO - cerca de ARTICULO)
 * H (7)  = CLIENTE        - Cliente que requiere la pieza
 * I (8)  = FECHA_REQUERIDA - Fecha de entrega del cliente (CLAVE para prioridad)
 * K (10) = CANTIDAD       - Cantidad requerida por cliente
 * L (11) = STOCK          - Cantidad ya fabricada
 * N (13) = PEDIDO         - Número de pedido
 * R (17) = BIN            - Stock mínimo acordado con cliente
 * T (19) = FASE_R         - Fases de fabricación pendientes
 * V (21) = LANZ           - OF de lanzamiento
 */
const COLUMN_INDICES = {
    ARTICULO: 5,           // Columna F: Código de artículo
    DESCRIPCION: 6,        // Columna G: Descripción (ASUMIDO - validar con usuario)
    CLIENTE: 7,            // Columna H: Cliente
    FECHA_REQUERIDA: 8,    // Columna I: Fecha de entrega (CRÍTICO)
    CANTIDAD: 10,          // Columna K: Cantidad requerida
    STOCK: 11,             // Columna L: Stock fabricado
    PEDIDO: 13,            // Columna N: Número de pedido
    BIN: 17,               // Columna R: Stock mínimo
    FASE_R: 19,            // Columna T: Fases pendientes
    LANZ: 21               // Columna V: OF lanzamiento
};

const INITIAL_ROW = 44; // Los datos inician en fila 44
const REQUIRED_SHEET = 'BASE DATOS';

/**
 * Lee y parsea el archivo Excel de prioridades
 * 
 * @param file - Archivo Excel (File object)
 * @returns Promise con array de PriorityArticle
 * @throws Error si el formato es inválido
 */
export async function parseExcelFile(file: File): Promise<PriorityArticle[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                // Validar estructura
                if (!validateExcelStructure(workbook)) {
                    reject(new Error(`El archivo debe contener una hoja llamada "${REQUIRED_SHEET}"`));
                    return;
                }

                const articles = extractPriorityData(workbook.Sheets[REQUIRED_SHEET]);
                resolve(articles);
            } catch (error) {
                reject(new Error(`Error al parsear Excel: ${(error as Error).message}`));
            }
        };

        reader.onerror = () => {
            reject(new Error('Error al leer el archivo'));
        };

        reader.readAsArrayBuffer(file);
    });
}

/**
 * Valida que el workbook tenga la estructura esperada
 */
export function validateExcelStructure(workbook: XLSX.WorkBook): boolean {
    // Verificar que exista la hoja "BASE DATOS"
    if (!workbook.Sheets[REQUIRED_SHEET]) {
        return false;
    }

    return true;
}

/**
 * Extrae datos de prioridad desde la hoja del Excel
 */
export function extractPriorityData(worksheet: XLSX.WorkSheet): PriorityArticle[] {
    const articles: PriorityArticle[] = [];

    // Convertir hoja a JSON para facilitar lectura
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

    if (DEBUG_MODE) {
        console.log('📊 [Excel Parser] Iniciando extracción de datos');
        console.log(`📊 [Excel Parser] Rango detectado: ${worksheet['!ref']}`);
        console.log(`📊 [Excel Parser] Filas totales: ${range.e.r + 1}`);
        console.log(`📊 [Excel Parser] Fila inicial de datos: ${INITIAL_ROW}`);
    }

    let articulosValidos = 0;
    let articulosSinFecha = 0;
    const MAX_ARTICLES = 5000; // Aumentado para leer todo el archivo (usuario tiene ~4000 filas)

    console.log(`📊 Iniciando parseo (máx ${MAX_ARTICLES} artículos)...`);

    // Iterar desde fila 44 (índice 43 en base 0)
    for (let rowNum = INITIAL_ROW - 1; rowNum <= range.e.r; rowNum++) {
        // Límite de seguridad
        if (articles.length >= MAX_ARTICLES) {
            logWarning(`⚠️ LÍMITE ALCANZADO: Se parsearon ${MAX_ARTICLES} artículos. Resto del Excel ignorado.`);
            break;
        }

        try {
            // Parsear fecha requerida (ahora en columna I)
            const fechaCellValue = getCellValue(worksheet, rowNum, COLUMN_INDICES.FECHA_REQUERIDA);
            let fechaRequerida: Date | null = null;

            if (fechaCellValue) {
                if (typeof fechaCellValue === 'number') {
                    const parsed = XLSX.SSF.parse_date_code(fechaCellValue);
                    fechaRequerida = new Date(parsed.y, parsed.m - 1, parsed.d);
                } else if (typeof fechaCellValue === 'string') {
                    const parsed = new Date(fechaCellValue);
                    if (!isNaN(parsed.getTime())) {
                        fechaRequerida = parsed;
                    }
                }
            }

            const articulo = getCellValue(worksheet, rowNum, COLUMN_INDICES.ARTICULO);

            if (!articulo || articulo.toString().trim() === '') {
                continue;
            }

            // Contar artículos sin fecha (pero NO descartarlos)
            if (!fechaRequerida) {
                articulosSinFecha++;
            }

            articulosValidos++;

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

            // Log detallado SOLO del primer artículo para validación
            if (DEBUG_MODE && articles.length === 1) {
                console.log(`\n📋 PRIMERA FILA PARSEADA (Fila ${rowNum}) - VALIDAR COLUMNAS:`);
                console.log(`   F (${COLUMN_INDICES.ARTICULO}): ARTICULO = "${article.articulo}"`);
                console.log(`   G (${COLUMN_INDICES.DESCRIPCION}): DESCRIPCION = "${article.descripcion}"`);
                console.log(`   H (${COLUMN_INDICES.CLIENTE}): CLIENTE = "${article.cliente}"`);
                console.log(`   I (${COLUMN_INDICES.FECHA_REQUERIDA}): FECHA_REQUERIDA = ${article.fechaRequerida?.toLocaleDateString()}`);
                console.log(`   K (${COLUMN_INDICES.CANTIDAD}): CANTIDAD = ${article.cantidad}`);
                console.log(`   L (${COLUMN_INDICES.STOCK}): STOCK = ${article.stock}`);
                console.log(`   N (${COLUMN_INDICES.PEDIDO}): PEDIDO = "${article.pedido}"`);
                console.log(`   R (${COLUMN_INDICES.BIN}): BIN = ${article.bin}`);
                console.log(`   T (${COLUMN_INDICES.FASE_R}): FASE_R = "${article.faseR}"`);
                console.log(`   V (${COLUMN_INDICES.LANZ}): LANZ = "${article.lanz}"`);
                console.log(`   ⚠️ SI ALGO NO COINCIDE, AVISAR PARA AJUSTAR ÍNDICES`);
            }
        } catch (error) {
            if (DEBUG_MODE) {
                logWarning(`⚠️ Error parseando fila ${rowNum}:`, error);
            }
        }
    }

    console.log(`✅ [Excel Parser] Extracción completada:`);
    console.log(`   - Artículos leídos: ${articles.length}`);
    console.log(`   - Artículos sin fecha (se mantienen): ${articulosSinFecha}`);

    // SIEMPRE mostrar primeros artículos para diagnóstico (fuera de DEBUG_MODE)
    console.log(`\n📦 PRIMEROS 10 ARTÍCULOS DEL EXCEL (columna F + V):`);
    articles.slice(0, 10).forEach((art, idx) => {
        console.log(`   ${idx + 1}. Artículo: "${art.articulo}" | OF: "${art.lanz}" - Cliente: ${art.cliente}`);
    });

    // DIAGNÓSTICO ESPECÍFICO: Buscar si "30100-03" existe en algún lugar del Excel
    const targetArticle = "30100-03";
    const found = articles.find(a => a.articulo?.includes(targetArticle));
    if (found) {
        console.log(`\n✅ ¡DIAGNÓSTICO ÉXITO! El artículo "${targetArticle}" SÍ existe en el Excel:`);
        console.log(`   - Artículo: "${found.articulo}"`);
        console.log(`   - OF (Lanz): "${found.lanz}"`);
        console.log(`   - Cliente: "${found.cliente}"`);
        console.log(`   👉 Si el ERP tiene este mismo Artículo y OF, el match funcionará.`);
    } else {
        console.log(`\n❌ DIAGNÓSTICO FALLIDO: El artículo "${targetArticle}" NO se encontró en los ${articles.length} artículos leídos.`);
        console.log(`   Posibles causas:`);
        console.log(`   1. El código en Excel es diferente (ej: tiene prefijos o espacios)`);
        console.log(`   2. Está más allá de la fila 5000`);
    }

    return articles;
}

/**
 * Obtiene el valor de una celda por fila y columna
 */
function getCellValue(worksheet: XLSX.WorkSheet, row: number, col: number): any {
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = worksheet[cellAddress];
    return cell ? cell.v : null;
}

/**
 * Parsea un valor a número, devuelve 0 si no es válido
 */
function parseNumber(value: any): number {
    if (value === null || value === undefined || value === '') {
        return 0;
    }
    const num = Number(value);
    return isNaN(num) ? 0 : num;
}

/**
 * Valida que un archivo sea un Excel válido
 */
export function isValidExcelFile(file: File): boolean {
    const validExtensions = ['.xlsx', '.xls'];
    const fileName = file.name.toLowerCase();
    return validExtensions.some(ext => fileName.endsWith(ext));
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER DE HOJA FINAL
// Para cuando el usuario ya tiene un Excel con la hoja "HOJA FINAL" generada
// previamente por las macros (sin necesitar ejecutar macros de nuevo).
//
// Columnas de HOJA FINAL (base 0, fila 0 = encabezados, datos desde fila 1):
//   A(0)  Artículo
//   B(1)  Desc. Artículo
//   C(2)  Fecha Entrega
//   D(3)  C.Pendiente
//   E(4)  C.Lanzada
//   F(5)  Stock
//   G(6)  CFases
//   H(7)  NOrden
// ─────────────────────────────────────────────────────────────────────────────
const HOJA_FINAL_NAME = 'HOJA FINAL';

/**
 * Lee un archivo Excel que contiene la hoja "HOJA FINAL" y extrae los artículos.
 */
export async function parseHojaFinalFile(file: File): Promise<PriorityArticle[]> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array', cellDates: false });

                if (!workbook.Sheets[HOJA_FINAL_NAME]) {
                    reject(new Error(`El archivo no contiene la hoja "${HOJA_FINAL_NAME}". Asegúrese de usar un Excel procesado por las macros.`));
                    return;
                }

                const articles = extractArticlesFromHojaFinal(workbook.Sheets[HOJA_FINAL_NAME]);
                resolve(articles);
            } catch (err) {
                reject(new Error(`Error al parsear HOJA FINAL: ${(err as Error).message}`));
            }
        };

        reader.onerror = () => reject(new Error('Error al leer el archivo'));
        reader.readAsArrayBuffer(file);
    });
}

function extractArticlesFromHojaFinal(ws: XLSX.WorkSheet): PriorityArticle[] {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const articles: PriorityArticle[] = [];

    // Fila 0 = encabezados → datos desde fila 1
    for (let rowNum = 1; rowNum <= range.e.r; rowNum++) {
        const articuloCell = ws[XLSX.utils.encode_cell({ r: rowNum, c: 0 })];
        const articulo = articuloCell ? articuloCell.v : null;
        if (!articulo || String(articulo).trim() === '') continue;

        const fechaCellValue = ws[XLSX.utils.encode_cell({ r: rowNum, c: 2 })]?.v;
        let fechaRequerida: Date | null = null;
        if (fechaCellValue) {
            if (typeof fechaCellValue === 'number') {
                const parsed = XLSX.SSF.parse_date_code(fechaCellValue);
                fechaRequerida = new Date(parsed.y, parsed.m - 1, parsed.d);
            } else if (typeof fechaCellValue === 'string') {
                const parsed = new Date(fechaCellValue);
                if (!isNaN(parsed.getTime())) fechaRequerida = parsed;
            }
        }

        // NOrden: puede ser lista separada por comas → usar el primero como OF
        const nOrdenRaw = ws[XLSX.utils.encode_cell({ r: rowNum, c: 7 })]?.v;
        let lanz = '';
        if (nOrdenRaw) {
            const parts = String(nOrdenRaw).split(',');
            lanz = parts[0]?.trim() || '';
        }

        const parseFinalNum = (colIdx: number): number => {
            const val = ws[XLSX.utils.encode_cell({ r: rowNum, c: colIdx })]?.v;
            if (val === null || val === undefined || val === '') return 0;
            const n = Number(val);
            return isNaN(n) ? 0 : n;
        };

        articles.push({
            articulo: String(articulo).trim(),
            descripcion: String(ws[XLSX.utils.encode_cell({ r: rowNum, c: 1 })]?.v || '').trim(),
            fechaRequerida,
            cantidad: parseFinalNum(3),   // C.Pendiente
            stock: parseFinalNum(5),
            cliente: '',
            pedido: '',
            bin: 0,
            faseR: String(ws[XLSX.utils.encode_cell({ r: rowNum, c: 6 })]?.v || '').trim(),
            lanz
        });
    }

    console.log(`✅ [HOJA FINAL Parser] ${articles.length} artículos extraídos`);
    return articles;
}

/**
 * Exporta un objeto Workbook de XLSX a un archivo descargable en el navegador.
 */
function parseDateForExport(value: any): Date | null {
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

function computeColumnWidthFromData(rows: any[][], colIndex: number): number {
    let maxLen = 10;

    for (const row of rows) {
        const value = row[colIndex];
        const text = value instanceof Date ? 'dd/mm/yyyy' : String(value ?? '');
        maxLen = Math.max(maxLen, text.length + 2);
    }

    return Math.min(maxLen, 70);
}

/**
 * Exporta con formato profesional (fuente, encabezados, bordes, filtros y fechas).
 */
export const exportWorkbookToFile = async (workbook: XLSX.WorkBook, fileName: string = 'despues macros.xlsx'): Promise<void> => {
    try {
        const professionalWb = new ExcelJS.Workbook();
        const sourceFirstSheet = workbook.SheetNames[0];
        const today = new Date();
        const todayAtStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

        for (const sheetName of workbook.SheetNames) {
            const sourceSheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sourceSheet, {
                header: 1,
                raw: true,
                defval: ''
            }) as any[][];

            const targetSheet = professionalWb.addWorksheet(sheetName, {
                views: [{ state: 'frozen', ySplit: 1 }]
            });

            if (!rows.length) continue;

            for (const row of rows) {
                targetSheet.addRow(row);
            }

            const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);
            if (maxCols === 0) continue;

            targetSheet.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: maxCols }
            };

            const sourceCols = ((sourceSheet as any)['!cols'] || []) as Array<{ wch?: number }>;
            for (let c = 1; c <= maxCols; c++) {
                const sourceWidth = sourceCols[c - 1]?.wch;
                targetSheet.getColumn(c).width = sourceWidth || computeColumnWidthFromData(rows, c - 1);
            }

            const headerValues = (rows[0] || []).map(header => String(header || '').toLowerCase());
            const dateColumns: number[] = [];
            headerValues.forEach((header, idx) => {
                if (header.includes('fecha')) dateColumns.push(idx + 1);
            });

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
                        (new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate()).getTime() - todayAtStart.getTime()) /
                        (1000 * 60 * 60 * 24)
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
        console.log(`✅ Archivo ${fileName} exportado y descargado.`);
    } catch (error) {
        logError('Error al exportar el archivo Excel:', error);
        throw new Error('No se pudo generar el archivo Excel para descarga.');
    }
};

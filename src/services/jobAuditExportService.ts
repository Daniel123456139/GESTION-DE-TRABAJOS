/**
 * Servicio de exportacion de reportes de auditoria de trabajos.
 * Genera reportes PDF de ocupacion e improductividad por departamento.
 */

import { rgb } from 'pdf-lib';
import logger from '../utils/logger';
import {
    A4_HEIGHT,
    A4_WIDTH,
    PAGE_MARGIN,
    addA4Page,
    addStandardFooter,
    createPdfBundle,
    drawCenteredText,
    sanitizePdfText,
    savePdfFile,
    wrapText,
} from './pdf/pdfExportUtils';

export interface JobAuditData {
    operario: number;
    nombre: string;
    departamento: string;
    totalPresence: number;
    totalCovered: number;
    totalJobTimeProduced: number;
    overlapRatio: number;
    timeGap: number;
    occupancy: number;
}

export interface ImproductiveRankingRow {
    operario: number;
    nombre: string;
    departamento: string;
    improductiveHours: number;
    improductivePercent: number;
    totalPresence: number;
}

export interface GlobalStats {
    totalPresence: number;
    totalCovered: number;
    totalImputed: number;
    occupancy: number;
    totalGap: number;
    totalImproductiveProduced?: number;
    avgEfficiency: number;
    employeeCount: number;
}

export interface ImproductiveArticleRow {
    articleId: string;
    articleName: string;
    totalHours: number;
    percentOfTotalImproductive: number;
    occurrenceCount: number;
}

export interface ReportOptions {
    startDate: string;
    endDate: string;
    department: string;
    includeEmployeeDetails?: boolean;
    watermark?: string;
}

function drawHeader(
    page: ReturnType<typeof addA4Page>,
    title: string,
    subtitleLines: string[],
    fill: [number, number, number],
    fonts: Awaited<ReturnType<typeof createPdfBundle>>['fonts']
): number {
    const headerHeight = 82;
    page.drawRectangle({
        x: 0,
        y: A4_HEIGHT - headerHeight,
        width: A4_WIDTH,
        height: headerHeight,
        color: rgb(fill[0] / 255, fill[1] / 255, fill[2] / 255)
    });

    drawCenteredText(page, fonts.bold, title, A4_HEIGHT - 30, 20, rgb(1, 1, 1));

    let y = A4_HEIGHT - 48;
    subtitleLines.forEach((line) => {
        drawCenteredText(page, fonts.regular, line, y, 10, rgb(1, 1, 1));
        y -= 12;
    });

    return A4_HEIGHT - headerHeight - 20;
}

function formatDate(dateStr: string): string {
    try {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    } catch {
        return dateStr;
    }
}

function drawTextLine(
    page: ReturnType<typeof addA4Page>,
    text: string,
    x: number,
    y: number,
    font: Awaited<ReturnType<typeof createPdfBundle>>['fonts']['regular'],
    size = 10,
    color = rgb(0.15, 0.15, 0.15)
): void {
    page.drawText(sanitizePdfText(text), { x, y, size, font, color });
}

export async function exportImproductiveByArticleToPDF(
    articleRows: ImproductiveArticleRow[],
    options: ReportOptions
): Promise<void> {
    try {
        const { startDate, endDate, department, watermark } = options;
        const { pdfDoc, fonts } = await createPdfBundle();
        let page = addA4Page(pdfDoc);
        let y = drawHeader(
            page,
            'IMPRODUCTIVIDAD POR ACTIVIDAD',
            [
                `Periodo: ${formatDate(startDate)} - ${formatDate(endDate)}`,
                `Departamento: ${department === 'all' ? 'Todos' : department}`
            ],
            [234, 88, 12],
            fonts
        );

        const totalHours = articleRows.reduce((acc, row) => acc + row.totalHours, 0);
        const totalOccurrences = articleRows.reduce((acc, row) => acc + row.occurrenceCount, 0);
        const mostFrequent = [...articleRows].sort((a, b) => b.totalHours - a.totalHours)[0];

        drawTextLine(page, `Horas totales improductivas: ${totalHours.toFixed(1)}h`, PAGE_MARGIN, y, fonts.bold, 11);
        y -= 16;
        drawTextLine(page, `Total incidencias: ${totalOccurrences}`, PAGE_MARGIN, y, fonts.regular, 10);
        y -= 14;
        drawTextLine(
            page,
            `Principal causa: ${mostFrequent ? mostFrequent.articleName : 'N/A'}`,
            PAGE_MARGIN,
            y,
            fonts.regular,
            10
        );
        y -= 24;

        const headers = [
            { title: '#', width: 20 },
            { title: 'ID', width: 55 },
            { title: 'Actividad', width: 215 },
            { title: 'Veces', width: 55 },
            { title: 'Horas', width: 65 },
            { title: '% Total', width: 70 },
        ];

        const drawTableHeader = (): void => {
            let x = PAGE_MARGIN;
            headers.forEach((header) => {
                drawTextLine(page, header.title, x, y, fonts.bold, 9);
                x += header.width;
            });
            y -= 12;
        };

        drawTableHeader();

        articleRows.forEach((row, idx) => {
            if (y < PAGE_MARGIN + 30) {
                page = addA4Page(pdfDoc);
                y = A4_HEIGHT - PAGE_MARGIN;
                drawTextLine(page, 'Continuacion: Improductividad por actividad', PAGE_MARGIN, y, fonts.bold, 11);
                y -= 18;
                drawTableHeader();
            }

            const values = [
                String(idx + 1),
                row.articleId,
                row.articleName,
                String(row.occurrenceCount),
                `${row.totalHours.toFixed(2)}h`,
                `${row.percentOfTotalImproductive.toFixed(1)}%`
            ];

            let x = PAGE_MARGIN;
            values.forEach((value, colIdx) => {
                const maxWidth = headers[colIdx].width - 4;
                const line = wrapText(fonts.regular, value, 8, maxWidth)[0] || '';
                drawTextLine(page, line, x, y, fonts.regular, 8);
                x += headers[colIdx].width;
            });

            y -= 10;
        });

        const pages = pdfDoc.getPages();
        const timestamp = new Date().toLocaleString('es-ES');
        pages.forEach((p, idx) => {
            addStandardFooter(p, fonts, idx + 1, pages.length, timestamp, watermark);
        });

        const deptName = department === 'all' ? 'Todos' : department.replace(/\s+/g, '_');
        const filename = `Improductivos_Actividad_${deptName}_${startDate}_${endDate}.pdf`;
        await savePdfFile(pdfDoc, filename);
        logger.success('Reporte de actividades improductivas exportado correctamente');
    } catch (error) {
        logger.error('Error exportando reporte de actividades:', error);
        throw error;
    }
}

export async function exportWeeklyJobAuditToPDF(
    globalStats: GlobalStats,
    employeeData: JobAuditData[],
    options: ReportOptions
): Promise<void> {
    try {
        const {
            startDate,
            endDate,
            department,
            includeEmployeeDetails = true,
            watermark
        } = options;

        const { pdfDoc, fonts } = await createPdfBundle();
        let page = addA4Page(pdfDoc);
        let y = drawHeader(
            page,
            'AUDITORIA DE TRABAJOS',
            [
                'Reporte semanal de ocupacion y eficiencia',
                `Periodo: ${formatDate(startDate)} - ${formatDate(endDate)}`,
                `Departamento: ${department === 'all' ? 'Todos' : department}`
            ],
            [79, 70, 229],
            fonts
        );

        drawTextLine(page, 'RESUMEN EJECUTIVO', PAGE_MARGIN, y, fonts.bold, 12);
        y -= 18;

        const summaryLines = [
            `Tiempo presencia total: ${globalStats.totalPresence.toFixed(1)}h`,
            `Tiempo cubierto total: ${globalStats.totalCovered.toFixed(1)}h`,
            `Tiempo imputado total: ${globalStats.totalImputed.toFixed(1)}h`,
            `Hueco total: ${globalStats.totalGap.toFixed(1)}h`,
            `Ocupacion global: ${globalStats.occupancy.toFixed(1)}%`,
            `Eficiencia media: ${globalStats.avgEfficiency.toFixed(1)}h por operario`,
            `Numero de operarios: ${globalStats.employeeCount}`
        ];

        summaryLines.forEach((line) => {
            drawTextLine(page, line, PAGE_MARGIN, y, fonts.regular, 10);
            y -= 13;
        });

        if (includeEmployeeDetails && employeeData.length > 0) {
            y -= 10;
            if (y < PAGE_MARGIN + 70) {
                page = addA4Page(pdfDoc);
                y = A4_HEIGHT - PAGE_MARGIN;
            }

            drawTextLine(page, 'DETALLE POR OPERARIO', PAGE_MARGIN, y, fonts.bold, 12);
            y -= 16;

            const headers = [
                { title: 'ID', width: 35 },
                { title: 'Operario', width: 130 },
                { title: 'Presencia', width: 65 },
                { title: 'Imputado', width: 65 },
                { title: 'Cubierto', width: 65 },
                { title: 'Hueco', width: 55 },
                { title: 'Multitask', width: 70 },
            ];

            const drawTableHeader = (): void => {
                let x = PAGE_MARGIN;
                headers.forEach((header) => {
                    drawTextLine(page, header.title, x, y, fonts.bold, 9);
                    x += header.width;
                });
                y -= 12;
            };

            drawTableHeader();

            employeeData.forEach((emp) => {
                if (y < PAGE_MARGIN + 30) {
                    page = addA4Page(pdfDoc);
                    y = A4_HEIGHT - PAGE_MARGIN;
                    drawTextLine(page, 'Continuacion: Detalle por operario', PAGE_MARGIN, y, fonts.bold, 11);
                    y -= 18;
                    drawTableHeader();
                }

                const values = [
                    `FV${emp.operario.toString().padStart(3, '0')}`,
                    emp.nombre,
                    `${emp.totalPresence.toFixed(1)}h`,
                    `${emp.totalJobTimeProduced.toFixed(1)}h`,
                    `${emp.totalCovered.toFixed(1)}h`,
                    `${emp.timeGap.toFixed(1)}h`,
                    `${(emp.overlapRatio * 100).toFixed(0)}%`
                ];

                let x = PAGE_MARGIN;
                values.forEach((value, colIdx) => {
                    const maxWidth = headers[colIdx].width - 4;
                    const line = wrapText(fonts.regular, value, 8, maxWidth)[0] || '';
                    drawTextLine(page, line, x, y, fonts.regular, 8);
                    x += headers[colIdx].width;
                });
                y -= 10;
            });
        }

        const pages = pdfDoc.getPages();
        const timestamp = new Date().toLocaleString('es-ES');
        pages.forEach((p, idx) => {
            addStandardFooter(p, fonts, idx + 1, pages.length, timestamp, watermark);
        });

        const deptName = department === 'all' ? 'Todos' : department.replace(/\s+/g, '_');
        const filename = `Auditoria_Trabajos_${deptName}_${startDate}_${endDate}.pdf`;
        await savePdfFile(pdfDoc, filename);

        logger.success('Reporte PDF de auditoria generado correctamente');
    } catch (error) {
        logger.error('Error generando reporte de auditoria:', error);
        throw error;
    }
}

export async function exportImproductiveRankingToPDF(
    rankingRows: ImproductiveRankingRow[],
    options: ReportOptions
): Promise<void> {
    try {
        const { startDate, endDate, department, watermark } = options;
        const { pdfDoc, fonts } = await createPdfBundle();
        let page = addA4Page(pdfDoc);
        let y = drawHeader(
            page,
            'RANKING DE IMPRODUCTIVOS',
            [
                `Periodo: ${formatDate(startDate)} - ${formatDate(endDate)}`,
                `Departamento: ${department === 'all' ? 'Todos' : department}`
            ],
            [217, 119, 6],
            fonts
        );

        const totalImproductive = rankingRows.reduce((acc, row) => acc + row.improductiveHours, 0);
        const employeesWithImproductive = rankingRows.filter((r) => r.improductiveHours > 0).length;
        const avgImproductive = employeesWithImproductive > 0
            ? totalImproductive / employeesWithImproductive
            : 0;

        drawTextLine(page, `Total improductivo: ${totalImproductive.toFixed(1)}h`, PAGE_MARGIN, y, fonts.bold, 11);
        y -= 16;
        drawTextLine(page, `Operarios afectados: ${employeesWithImproductive}`, PAGE_MARGIN, y, fonts.regular, 10);
        y -= 13;
        drawTextLine(page, `Media por operario: ${avgImproductive.toFixed(1)}h`, PAGE_MARGIN, y, fonts.regular, 10);
        y -= 22;

        const headers = [
            { title: '#', width: 20 },
            { title: 'ID', width: 45 },
            { title: 'Operario', width: 140 },
            { title: 'Dept.', width: 90 },
            { title: 'Improductivo', width: 80 },
            { title: '% Pres.', width: 70 },
            { title: 'Presencia', width: 70 },
        ];

        const drawTableHeader = (): void => {
            let x = PAGE_MARGIN;
            headers.forEach((header) => {
                drawTextLine(page, header.title, x, y, fonts.bold, 9);
                x += header.width;
            });
            y -= 12;
        };

        drawTableHeader();

        rankingRows.forEach((row, idx) => {
            if (y < PAGE_MARGIN + 30) {
                page = addA4Page(pdfDoc);
                y = A4_HEIGHT - PAGE_MARGIN;
                drawTextLine(page, 'Continuacion: Ranking improductivos', PAGE_MARGIN, y, fonts.bold, 11);
                y -= 18;
                drawTableHeader();
            }

            const values = [
                String(idx + 1),
                `FV${row.operario.toString().padStart(3, '0')}`,
                row.nombre,
                row.departamento,
                `${row.improductiveHours.toFixed(2)}h`,
                `${row.improductivePercent.toFixed(1)}%`,
                `${row.totalPresence.toFixed(2)}h`
            ];

            let x = PAGE_MARGIN;
            values.forEach((value, colIdx) => {
                const maxWidth = headers[colIdx].width - 4;
                const line = wrapText(fonts.regular, value, 8, maxWidth)[0] || '';
                drawTextLine(page, line, x, y, fonts.regular, 8);
                x += headers[colIdx].width;
            });

            y -= 10;
        });

        const pages = pdfDoc.getPages();
        const timestamp = new Date().toLocaleString('es-ES');
        pages.forEach((p, idx) => {
            addStandardFooter(p, fonts, idx + 1, pages.length, timestamp, watermark);
        });

        const deptName = department === 'all' ? 'Todos' : department.replace(/\s+/g, '_');
        const filename = `Ranking_Improductivos_${deptName}_${startDate}_${endDate}.pdf`;
        await savePdfFile(pdfDoc, filename);
        logger.success('Ranking de improductivos exportado correctamente');
    } catch (error) {
        logger.error('Error exportando ranking de improductivos:', error);
        throw error;
    }
}

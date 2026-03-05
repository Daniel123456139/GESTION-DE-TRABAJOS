/**
 * SERVICIO DE EXPORTACION DE ANALISIS DE PRIORIDADES
 *
 * Responsabilidad: Generar reportes PDF y Excel del dashboard de prioridades.
 */

import ExcelJS from 'exceljs';
import html2canvas from 'html2canvas';
import { saveAs } from 'file-saver';
import { rgb } from 'pdf-lib';
import { EmployeePriorityAnalysis, GlobalPriorityStats } from '../types';
import { formatHours } from './priorityAnalysisService';
import { logError, logWarning } from '../utils/logger';
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

interface ExportOptions {
    startDate: string;
    endDate: string;
    department?: string;
}

export async function exportPriorityDashboardToPDF(
    stats: GlobalPriorityStats,
    employeeData: EmployeePriorityAnalysis[],
    options: ExportOptions
): Promise<void> {
    const { pdfDoc, fonts } = await createPdfBundle();

    const captureElement = document.getElementById('priority-dashboard-capture');
    if (captureElement) {
        try {
            const canvas = await html2canvas(captureElement, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                windowWidth: captureElement.scrollWidth,
                windowHeight: captureElement.scrollHeight,
                scrollX: 0,
                scrollY: -window.scrollY,
                ignoreElements: (el) => (el as HTMLElement).dataset?.exportIgnore === 'true',
            });

            const imageBytes = await fetch(canvas.toDataURL('image/png')).then((res) => res.arrayBuffer());
            const image = await pdfDoc.embedPng(imageBytes);
            const page = addA4Page(pdfDoc);

            const maxWidth = A4_WIDTH - (PAGE_MARGIN * 2);
            const maxHeight = A4_HEIGHT - (PAGE_MARGIN * 2);
            const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
            const imageWidth = image.width * scale;
            const imageHeight = image.height * scale;

            page.drawImage(image, {
                x: (A4_WIDTH - imageWidth) / 2,
                y: A4_HEIGHT - PAGE_MARGIN - imageHeight,
                width: imageWidth,
                height: imageHeight,
            });
        } catch (error) {
            logWarning('No se pudo capturar el dashboard visual para PDF.', error);
        }
    }

    let page = addA4Page(pdfDoc);
    let y = A4_HEIGHT - PAGE_MARGIN;

    const ensureSpace = (requiredHeight: number): void => {
        if (y - requiredHeight < PAGE_MARGIN + 24) {
            page = addA4Page(pdfDoc);
            y = A4_HEIGHT - PAGE_MARGIN;
        }
    };

    const writeLine = (text: string, size = 10, bold = false): void => {
        ensureSpace(size + 6);
        page.drawText(sanitizePdfText(text), {
            x: PAGE_MARGIN,
            y,
            size,
            font: bold ? fonts.bold : fonts.regular,
            color: rgb(0.12, 0.12, 0.12)
        });
        y -= size + 6;
    };

    const writeWrapped = (text: string, size = 10): void => {
        const lines = wrapText(fonts.regular, text, size, A4_WIDTH - (PAGE_MARGIN * 2));
        for (const line of lines) writeLine(line, size, false);
    };

    drawCenteredText(page, fonts.bold, 'ANALISIS DE PRIORIDADES', y - 4, 18, rgb(0.2, 0.2, 0.2));
    y -= 28;

    drawCenteredText(
        page,
        fonts.regular,
        `Periodo: ${options.startDate} - ${options.endDate}`,
        y,
        10,
        rgb(0.25, 0.25, 0.25)
    );
    y -= 16;

    if (options.department && options.department !== 'all') {
        drawCenteredText(
            page,
            fonts.regular,
            `Departamento: ${options.department}`,
            y,
            10,
            rgb(0.25, 0.25, 0.25)
        );
        y -= 16;
    }

    y -= 8;
    writeLine('RESUMEN GLOBAL', 12, true);
    writeWrapped(`Tasa de exito: ${stats.tasaExito.toFixed(0)}%`);
    writeWrapped(`Total articulos analizados: ${stats.totalArticulos}`);
    writeWrapped(`Trabajos correctos urgentes: ${stats.trabajosCorrectos} (${formatHours(stats.horasCorrectas)})`);
    writeWrapped(`Desviaciones no urgentes: ${stats.desviaciones} (${formatHours(stats.horasDesviadas)})`);

    y -= 6;
    writeLine('TOP 5 OPERARIOS CON MAS DESVIACIONES', 12, true);
    const top5 = [...employeeData]
        .sort((a, b) => b.trabajosNoUrgentes - a.trabajosNoUrgentes)
        .slice(0, 5);

    top5.forEach((emp, index) => {
        writeWrapped(
            `${index + 1}. ${emp.employeeName}: ${emp.trabajosNoUrgentes} no urgentes, ${formatHours(emp.horasNoUrgentes)}`,
            10
        );
    });

    y -= 6;
    writeLine('DETALLE POR EMPLEADO', 12, true);

    const columns = [
        { title: 'Empleado', width: 130 },
        { title: 'Urg.', width: 45 },
        { title: 'H. Urg.', width: 55 },
        { title: 'No Urg.', width: 55 },
        { title: 'H. No Urg.', width: 65 },
        { title: '%', width: 35 },
    ];

    const drawTableHeader = (): void => {
        ensureSpace(18);
        let x = PAGE_MARGIN;
        columns.forEach((col) => {
            page.drawText(col.title, {
                x,
                y,
                size: 9,
                font: fonts.bold,
                color: rgb(0.18, 0.18, 0.18)
            });
            x += col.width;
        });
        y -= 12;
    };

    drawTableHeader();

    for (const emp of employeeData) {
        ensureSpace(14);
        let x = PAGE_MARGIN;
        const row = [
            emp.employeeName.slice(0, 26),
            String(emp.trabajosUrgentes),
            formatHours(emp.horasUrgentes),
            String(emp.trabajosNoUrgentes),
            formatHours(emp.horasNoUrgentes),
            `${emp.cumplimiento.toFixed(0)}%`
        ];

        row.forEach((value, idx) => {
            page.drawText(sanitizePdfText(value), {
                x,
                y,
                size: 9,
                font: fonts.regular,
                color: rgb(0.2, 0.2, 0.2)
            });
            x += columns[idx].width;
        });

        y -= 11;
        if (y < PAGE_MARGIN + 24) {
            page = addA4Page(pdfDoc);
            y = A4_HEIGHT - PAGE_MARGIN;
            drawTableHeader();
        }
    }

    const pages = pdfDoc.getPages();
    const timestamp = new Date().toLocaleString('es-ES');
    pages.forEach((p, idx) => {
        addStandardFooter(p, fonts, idx + 1, pages.length, timestamp);
    });

    const fileName = `analisis_prioridades_${options.startDate}_${options.endDate}.pdf`;
    await savePdfFile(pdfDoc, fileName);
}

export async function exportPriorityDataToExcel(
    employeeData: EmployeePriorityAnalysis[]
): Promise<void> {
    try {
        const workbook = new ExcelJS.Workbook();

        const summarySheet = workbook.addWorksheet('Resumen Empleados');
        summarySheet.columns = [
            { header: 'Empleado', key: 'empleado', width: 28 },
            { header: 'ID', key: 'id', width: 12 },
            { header: 'Trabajos Urgentes', key: 'urgentes', width: 18 },
            { header: 'Horas Urgentes', key: 'horasUrgentes', width: 16 },
            { header: 'Trabajos NO Urgentes', key: 'noUrgentes', width: 20 },
            { header: 'Horas NO Urgentes', key: 'horasNoUrgentes', width: 18 },
            { header: '% Cumplimiento', key: 'cumplimiento', width: 16 }
        ];

        employeeData.forEach((emp) => {
            summarySheet.addRow({
                empleado: emp.employeeName,
                id: emp.employeeId,
                urgentes: emp.trabajosUrgentes,
                horasUrgentes: Number(emp.horasUrgentes.toFixed(1)),
                noUrgentes: emp.trabajosNoUrgentes,
                horasNoUrgentes: Number(emp.horasNoUrgentes.toFixed(1)),
                cumplimiento: Number(emp.cumplimiento.toFixed(1))
            });
        });

        const detailSheet = workbook.addWorksheet('Detalle Trabajos');
        detailSheet.columns = [
            { header: 'Empleado', key: 'empleado', width: 28 },
            { header: 'Articulo/OF', key: 'articulo', width: 22 },
            { header: 'Descripcion', key: 'descripcion', width: 38 },
            { header: 'Cliente', key: 'cliente', width: 24 },
            { header: 'Fecha Entrega', key: 'fechaEntrega', width: 16 },
            { header: 'Dias hasta Entrega', key: 'dias', width: 18 },
            { header: 'Horas Dedicadas', key: 'horas', width: 16 },
            { header: 'Estado', key: 'estado', width: 16 }
        ];

        employeeData.forEach((emp) => {
            emp.trabajosDetalle.forEach((work) => {
                detailSheet.addRow({
                    empleado: emp.employeeName,
                    articulo: work.articleId,
                    descripcion: work.descripcion,
                    cliente: work.cliente,
                    fechaEntrega: work.fechaRequerida
                        ? work.fechaRequerida.toLocaleDateString('es-ES')
                        : 'Sin fecha',
                    dias: work.diasHastaEntrega ?? 'N/A',
                    horas: Number(work.horasDedicadas.toFixed(1)),
                    estado: work.urgency === 'URGENTE' ? 'URGENTE' : 'NO URGENTE'
                });
            });
        });

        [summarySheet, detailSheet].forEach((sheet) => {
            sheet.getRow(1).font = { bold: true };
            sheet.views = [{ state: 'frozen', ySplit: 1 }];
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        const fileName = `datos_prioridades_${new Date().toISOString().slice(0, 10)}.xlsx`;
        saveAs(blob, fileName);
    } catch (error) {
        logError('Error exportando Excel de prioridades:', error);
        throw error;
    }
}

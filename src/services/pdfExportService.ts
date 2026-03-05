/**
 * Servicio de exportacion a PDF
 * Genera PDFs de fichas de empleados.
 */

import html2canvas from 'html2canvas';
import { rgb } from 'pdf-lib';
import { EmployeeProfile } from '../types';
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

export interface PDFExportOptions {
    includeCompetencias?: boolean;
    includeNotas?: boolean;
    includeTimestamp?: boolean;
    watermark?: string;
}

export async function exportEmployeeCardToPDF(
    elementId: string,
    filename?: string
): Promise<void> {
    try {
        logger.info('Iniciando exportacion a PDF de la ficha visual...');

        const element = document.getElementById(elementId);
        if (!element) {
            throw new Error(`Elemento ${elementId} no encontrado`);
        }

        const canvas = await html2canvas(element, {
            scale: 2,
            logging: false,
            useCORS: true,
            backgroundColor: '#ffffff'
        });

        const { pdfDoc, fonts } = await createPdfBundle();
        const page = addA4Page(pdfDoc);

        const imageBytes = await fetch(canvas.toDataURL('image/png')).then((res) => res.arrayBuffer());
        const image = await pdfDoc.embedPng(imageBytes);

        const maxWidth = A4_WIDTH - (PAGE_MARGIN * 2);
        const maxHeight = A4_HEIGHT - (PAGE_MARGIN * 2);
        const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
        const imgWidth = image.width * scale;
        const imgHeight = image.height * scale;

        page.drawImage(image, {
            x: (A4_WIDTH - imgWidth) / 2,
            y: A4_HEIGHT - PAGE_MARGIN - imgHeight,
            width: imgWidth,
            height: imgHeight,
        });

        const pages = pdfDoc.getPages();
        const timestamp = new Date().toLocaleString('es-ES');
        pages.forEach((p, idx) => addStandardFooter(p, fonts, idx + 1, pages.length, timestamp));

        const finalFilename = filename || `ficha_empleado_${Date.now()}.pdf`;
        await savePdfFile(pdfDoc, finalFilename);

        logger.success('PDF generado correctamente');
    } catch (error) {
        logger.error('Error exportando a PDF:', error);
        throw error;
    }
}

export async function exportEmployeeProfileToPDF(
    employee: EmployeeProfile,
    options: PDFExportOptions = {}
): Promise<void> {
    try {
        const {
            includeCompetencias = true,
            includeNotas = true,
            includeTimestamp = true,
            watermark,
        } = options;

        logger.info('Generando PDF programatico de ficha de empleado...');

        const { pdfDoc, fonts } = await createPdfBundle();
        let page = addA4Page(pdfDoc);
        let y = A4_HEIGHT - PAGE_MARGIN;

        const ensureSpace = (requiredHeight: number): void => {
            if (y - requiredHeight < PAGE_MARGIN + 24) {
                page = addA4Page(pdfDoc);
                y = A4_HEIGHT - PAGE_MARGIN;
            }
        };

        const writeTitle = (text: string): void => {
            ensureSpace(24);
            drawCenteredText(page, fonts.bold, text, y, 18, rgb(0.18, 0.18, 0.18));
            y -= 28;
        };

        const writeSection = (text: string): void => {
            ensureSpace(18);
            page.drawText(sanitizePdfText(text), {
                x: PAGE_MARGIN,
                y,
                size: 12,
                font: fonts.bold,
                color: rgb(0.2, 0.2, 0.2)
            });
            y -= 16;
        };

        const writeLine = (text: string, fontSize = 10): void => {
            const lines = wrapText(fonts.regular, text, fontSize, A4_WIDTH - (PAGE_MARGIN * 2));
            for (const line of lines) {
                ensureSpace(fontSize + 5);
                page.drawText(line, {
                    x: PAGE_MARGIN,
                    y,
                    size: fontSize,
                    font: fonts.regular,
                    color: rgb(0.15, 0.15, 0.15)
                });
                y -= fontSize + 4;
            }
        };

        writeTitle('FICHA DE EMPLEADO');

        writeSection('Informacion personal');
        writeLine(`Nombre: ${employee.DescOperario}`);
        writeLine(`ID: FV${employee.IDOperario.toString().padStart(3, '0')}`);
        writeLine(`Departamento: ${employee.DescDepartamento}`);
        writeLine(`Estado: ${employee.Activo ? 'Activo' : 'Inactivo'}`);

        if (employee.FechaAntiguedad || employee.NivelRetributivo || employee.Categoria || employee.Seccion || employee.TurnoHabitual) {
            y -= 6;
            writeSection('Datos laborales');

            if (employee.FechaAntiguedad) writeLine(`Antiguedad: ${formatDate(employee.FechaAntiguedad)}`);
            if (employee.NivelRetributivo) writeLine(`Nivel retributivo: ${employee.NivelRetributivo}`);
            if (employee.Categoria) writeLine(`Categoria: ${employee.Categoria}`);
            if (employee.Seccion) writeLine(`Seccion: ${employee.Seccion}`);
            if (employee.TurnoHabitual) {
                writeLine(`Turno: ${employee.TurnoHabitual === 'M' ? 'Manana' : 'Tarde-Noche'}`);
            }
        }

        if (includeCompetencias && employee.competencias && employee.competencias.length > 0) {
            y -= 6;
            writeSection('Competencias evaluadas');

            employee.competencias.forEach((comp) => {
                const nivelText = ['', 'Basico', 'Intermedio', 'Avanzado'][comp.nivel] || 'N/A';
                writeLine(`- ${comp.skillName}: ${nivelText}`, 9);
            });
        }

        if (includeNotas && employee.notas && employee.notas.length > 0) {
            y -= 6;
            writeSection('Notas de seguimiento');

            employee.notas.slice(0, 5).forEach((nota) => {
                writeLine(`[${nota.tipo.toUpperCase()}] ${formatDate(nota.fecha)}`, 9);
                writeLine(nota.contenido, 9);
                y -= 3;
            });
        }

        const pages = pdfDoc.getPages();
        const timestamp = includeTimestamp ? new Date().toLocaleString('es-ES') : '';
        pages.forEach((p, idx) => {
            addStandardFooter(
                p,
                fonts,
                idx + 1,
                pages.length,
                timestamp || '-',
                watermark
            );
        });

        const outputName = `Ficha_${employee.DescOperario.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
        await savePdfFile(pdfDoc, outputName);

        logger.success('PDF generado correctamente');
    } catch (error) {
        logger.error('Error generando PDF:', error);
        throw error;
    }
}

function formatDate(dateStr?: string): string {
    if (!dateStr) return 'N/A';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('es-ES', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (error) {
        logger.warn('No se pudo formatear fecha para PDF', {
            source: 'pdfExportService.formatDate',
            dateStr,
            reason: error
        });
        return dateStr;
    }
}

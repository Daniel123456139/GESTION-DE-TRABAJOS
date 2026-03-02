/**
 * Servicio de Exportación a PDF
 * Genera PDFs profesionales de fichas de empleados
 * 
 * @module pdfExportService
 */

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { EmployeeProfile } from '../types';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════

export interface PDFExportOptions {
    includeCompetencias?: boolean;
    includeNotas?: boolean;
    includeTimestamp?: boolean;
    watermark?: string;
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES PRINCIPALES
// ═══════════════════════════════════════════════════════════════════

/**
 * Exportar ficha de empleado a PDF (Método Simple - HTML to PDF)
 * Captura el elemento DOM y lo convierte a PDF
 */
export async function exportEmployeeCardToPDF(
    elementId: string,
    filename?: string
): Promise<void> {
    try {
        logger.info('📄 Iniciando exportación a PDF...');

        const element = document.getElementById(elementId);
        if (!element) {
            throw new Error(`Elemento ${elementId} no encontrado`);
        }

        // Capturar elemento como imagen
        const canvas = await html2canvas(element, {
            scale: 2,
            logging: false,
            useCORS: true
        });

        const imgData = canvas.toDataURL('image/png');

        // Crear PDF (A4 = 210 x 297 mm)
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();

        // Calcular dimensiones para ajustar al PDF
        const imgWidth = pdfWidth - 20; // Margen de 10mm  a cada lado
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        // Añadir imagen al PDF
        pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, Math.min(imgHeight, pdfHeight - 20));

        // Guardar
        const finalFilename = filename || `ficha_empleado_${Date.now()}.pdf`;
        pdf.save(finalFilename);

        logger.success('✅ PDF generado correctamente');
    } catch (error) {
        logger.error('❌ Error exportando a PDF:', error);
        throw error;
    }
}

/**
 * Exportar ficha de empleado a PDF (Método Programático)
 * Construye el PDF desde cero con mejor control
 */
export async function exportEmployeeProfileToPDF(
    employee: EmployeeProfile,
    options: PDFExportOptions = {}
): Promise<void> {
    try {
        const {
            includeCompetencias = true,
            includeNotas = true,
            includeTimestamp = true,
            watermark
        } = options;

        logger.info('📄 Generando PDF programático...');

        const pdf = new jsPDF('p', 'mm', 'a4');
        let yPosition = 20;

        // ═══ HEADER ═══
        pdf.setFontSize(20);
        pdf.setFont('helvetica', 'bold');
        pdf.text('FICHA DE EMPLEADO', 105, yPosition, { align: 'center' });
        yPosition += 15;

        // ═══ INFORMACIÓN BÁSICA ═══
        pdf.setFontSize(12);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Información Personal', 15, yPosition);
        yPosition += 8;

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);

        const basicInfo = [
            `Nombre: ${employee.DescOperario}`,
            `ID: FV${employee.IDOperario.toString().padStart(3, '0')}`,
            `Departamento: ${employee.DescDepartamento}`,
            `Estado: ${employee.Activo ? 'Activo' : 'Inactivo'}`
        ];

        basicInfo.forEach(line => {
            pdf.text(line, 15, yPosition);
            yPosition += 6;
        });

        yPosition += 5;

        // ═══ DATOS LABORALES ═══
        if (employee.FechaAntiguedad || employee.NivelRetributivo || employee.Categoria) {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(12);
            pdf.text('Datos Laborales', 15, yPosition);
            yPosition += 8;

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);

            const laboralInfo: string[] = [];
            if (employee.FechaAntiguedad) laboralInfo.push(`Antigüedad: ${formatDate(employee.FechaAntiguedad)}`);
            if (employee.NivelRetributivo) laboralInfo.push(`Nivel Retributivo: ${employee.NivelRetributivo}`);
            if (employee.Categoria) laboralInfo.push(`Categoría: ${employee.Categoria}`);
            if (employee.Seccion) laboralInfo.push(`Sección: ${employee.Seccion}`);
            if (employee.TurnoHabitual) laboralInfo.push(`Turno: ${employee.TurnoHabitual === 'M' ? 'Mañana' : 'Tarde-Noche'}`);

            laboralInfo.forEach(line => {
                pdf.text(line, 15, yPosition);
                yPosition += 6;
            });

            yPosition += 5;
        }

        // ═══ COMPETENCIAS ═══
        if (includeCompetencias && employee.competencias && employee.competencias.length > 0) {
            // Nueva página si no hay espacio
            if (yPosition > 240) {
                pdf.addPage();
                yPosition = 20;
            }

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(12);
            pdf.text('Competencias Evaluadas', 15, yPosition);
            yPosition += 8;

            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(9);

            employee.competencias.forEach(comp => {
                const nivelText = ['', 'Básico', 'Intermedio', 'Avanzado'][comp.nivel];
                pdf.text(`• ${comp.skillName}: ${nivelText}`, 15, yPosition);
                yPosition += 5;

                if (yPosition > 280) {
                    pdf.addPage();
                    yPosition = 20;
                }
            });

            yPosition += 5;
        }

        // ═══ NOTAS ═══
        if (includeNotas && employee.notas && employee.notas.length > 0) {
            if (yPosition > 240) {
                pdf.addPage();
                yPosition = 20;
            }

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(12);
            pdf.text('Notas de Seguimiento', 15, yPosition);
            yPosition += 8;

            pdf.setFontSize(9);

            employee.notas.slice(0, 5).forEach(nota => { // Solo primeras 5 notas
                pdf.setFont('helvetica', 'bold');
                pdf.text(`[${nota.tipo.toUpperCase()}] ${formatDate(nota.fecha)}`, 15, yPosition);
                yPosition += 5;

                pdf.setFont('helvetica', 'normal');
                const lines = pdf.splitTextToSize(nota.contenido, 180);
                pdf.text(lines, 15, yPosition);
                yPosition += lines.length * 5;
                yPosition += 3;

                if (yPosition > 280) {
                    pdf.addPage();
                    yPosition = 20;
                }
            });
        }

        // ═══ FOOTER ═══
        const pageCount = pdf.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'italic');
            pdf.setTextColor(150);

            if (includeTimestamp) {
                pdf.text(
                    `Generado: ${new Date().toLocaleString('es-ES')}`,
                    15,
                    pdf.internal.pageSize.getHeight() - 10
                );
            }

            pdf.text(
                `Página ${i} de ${pageCount}`,
                pdf.internal.pageSize.getWidth() - 40,
                pdf.internal.pageSize.getHeight() - 10
            );

            if (watermark) {
                pdf.setTextColor(200);
                pdf.setFontSize(50);
                pdf.text(watermark, 105, 150, {
                    align: 'center',
                    angle: 45,
                });
            }
        }

        // Guardar
        const filename = `Ficha_${employee.DescOperario.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
        pdf.save(filename);

        logger.success('✅ PDF generado correctamente');
    } catch (error) {
        logger.error('❌ Error generando PDF:', error);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function formatDate(dateStr?: string): string {
    if (!dateStr) return 'N/A';
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (error) {
        logger.warn('No se pudo formatear fecha para PDF', {
            source: 'pdfExportService.formatDate',
            dateStr,
            reason: error
        });
        return dateStr;
    }
}

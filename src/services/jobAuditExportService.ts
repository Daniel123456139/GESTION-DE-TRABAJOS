/**
 * Servicio de Exportación de Reportes de Auditoría de Trabajos
 * Genera PDFs profesionales con resumen de ocupación y eficiencia por departamento
 * 
 * @module jobAuditExportService
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import logger from '../utils/logger';

// ═══════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════

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

/**
 * Exportar Reporte de Improductivos por Actividad/Artículo a PDF
 */
export async function exportImproductiveByArticleToPDF(
    articleRows: ImproductiveArticleRow[],
    options: ReportOptions
): Promise<void> {
    try {
        const { startDate, endDate, department, watermark } = options;

        const pdf = new jsPDF('p', 'mm', 'a4');
        let yPosition = 20;

        // ═══ HEADER ═══
        pdf.setFillColor(234, 88, 12); // orange-600
        pdf.rect(0, 0, 210, 40, 'F');

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(20);
        pdf.setFont('helvetica', 'bold');
        pdf.text('IMPRODUCTIVIDAD POR ACTIVIDAD', 105, 16, { align: 'center' });

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Periodo: ${formatDate(startDate)} - ${formatDate(endDate)}`, 105, 26, { align: 'center' });
        pdf.text(`Departamento: ${department === 'all' ? 'Todos' : department}`, 105, 33, { align: 'center' });

        yPosition = 55;

        const totalHours = articleRows.reduce((acc, row) => acc + row.totalHours, 0);
        const totalOccurrences = articleRows.reduce((acc, row) => acc + row.occurrenceCount, 0);
        const mostFrequent = articleRows.sort((a, b) => b.totalHours - a.totalHours)[0];

        // ═══ KPI CARDS ═══
        drawKpiCard(pdf, 15, yPosition, 60, 30, 'Horas Totales', `${totalHours.toFixed(1)}h`, 'En actividades improduct.', [234, 88, 12]);
        drawKpiCard(pdf, 80, yPosition, 60, 30, 'Nº Incidencias', `${totalOccurrences}`, 'Registros totales', [59, 130, 246]);

        if (mostFrequent) {
            drawKpiCard(pdf, 145, yPosition, 50, 30, 'Principal Causa', `${mostFrequent.articleName.substring(0, 10)}...`, `${mostFrequent.totalHours.toFixed(1)}h`, [220, 38, 38]);
        }

        yPosition += 40;

        // ═══ CHART (Simple Bar Chart Simulation) ═══
        // ... (Skipped for brevity/complexity, focus on table)

        const tableData = articleRows.map((row, idx) => [
            String(idx + 1),
            row.articleId,
            row.articleName,
            `${row.occurrenceCount}`,
            `${row.totalHours.toFixed(2)}h`,
            `${row.percentOfTotalImproductive.toFixed(1)}%`
        ]);

        autoTable(pdf, {
            startY: yPosition,
            head: [['#', 'ID', 'Actividad', 'Veces', 'Horas', '% Total']],
            body: tableData,
            theme: 'grid',
            headStyles: {
                fillColor: [234, 88, 12],
                textColor: 255,
                fontStyle: 'bold',
                fontSize: 10
            },
            bodyStyles: {
                fontSize: 9,
                textColor: [51, 65, 85]
            },
            columnStyles: {
                0: { cellWidth: 10, halign: 'center' },
                1: { cellWidth: 20, fontStyle: 'bold' },
                2: { cellWidth: 80 },
                3: { cellWidth: 20, halign: 'right' },
                4: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
                5: { cellWidth: 25, halign: 'right' }
            }
        });

        // ═══ FOOTER ═══
        const pageCount = pdf.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'italic');
            pdf.setTextColor(148, 163, 184);

            pdf.text(
                `Generado: ${new Date().toLocaleString('es-ES')}`,
                15,
                pdf.internal.pageSize.getHeight() - 10
            );

            pdf.text(
                `Página ${i} de ${pageCount}`,
                pdf.internal.pageSize.getWidth() - 40,
                pdf.internal.pageSize.getHeight() - 10
            );

            if (watermark) {
                pdf.setTextColor(220, 220, 220);
                pdf.setFontSize(50);
                pdf.text(watermark, 105, 150, {
                    align: 'center',
                    angle: 45,
                });
            }
        }

        const deptName = department === 'all' ? 'Todos' : department.replace(/\s+/g, '_');
        const filename = `Improductivos_Actividad_${deptName}_${startDate}_${endDate}.pdf`;
        pdf.save(filename);
        logger.success('✅ Reporte de Actividades Improductivas exportado correctamente');
    } catch (error) {
        logger.error('❌ Error exportando reporte de actividades:', error);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function drawKpiCard(
    pdf: jsPDF,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    value: string,
    subtitle: string,
    color: [number, number, number]
): void {
    // Fondo de la tarjeta
    pdf.setFillColor(255, 255, 255);
    pdf.setDrawColor(226, 232, 240); // slate-200
    pdf.setLineWidth(0.5);
    pdf.roundedRect(x, y, width, height, 2, 2, 'FD');

    // Icono de color
    pdf.setFillColor(...color);
    pdf.circle(x + 6, y + 8, 3, 'F');

    // Label
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(148, 163, 184); // slate-400
    pdf.text(label.toUpperCase(), x + 12, y + 6);

    // Valor principal
    pdf.setFontSize(14); // Slightly smaller to fit long names
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59); // slate-800

    // Truncate if too long
    let displayValue = value;
    if (pdf.getTextWidth(value) > width - 10) {
        // Simple truncation
        // displayValue = value.substring(0, 15) + '...'; 
    }

    pdf.text(displayValue, x + width / 2, y + 18, { align: 'center' });

    // Subtítulo
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 116, 139); // slate-500
    pdf.text(subtitle, x + width / 2, y + 25, { align: 'center' });
}

export interface ReportOptions {
    startDate: string;
    endDate: string;
    department: string;
    includeEmployeeDetails?: boolean;
    watermark?: string;
}

// ═══════════════════════════════════════════════════════════════════
// FUNCIONES PRINCIPALES
// ═══════════════════════════════════════════════════════════════════

/**
 * Exportar Reporte Semanal de Auditoría de Trabajos a PDF
 */
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

        logger.info('📄 Generando Reporte Semanal de Auditoría...');

        const pdf = new jsPDF('p', 'mm', 'a4');
        let yPosition = 20;

        // ═══ HEADER ═══
        pdf.setFillColor(79, 70, 229); // Indigo-600
        pdf.rect(0, 0, 210, 40, 'F');

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(20);
        pdf.setFont('helvetica', 'bold');
        pdf.text('AUDITORÍA DE TRABAJOS', 105, 15, { align: 'center' });

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.text('Reporte Semanal de Ocupación y Eficiencia', 105, 23, { align: 'center' });
        pdf.text(`Periodo: ${formatDate(startDate)} - ${formatDate(endDate)}`, 105, 30, { align: 'center' });
        pdf.text(`Departamento: ${department === 'all' ? 'Todos' : department}`, 105, 36, { align: 'center' });

        yPosition = 55;

        // ═══ RESUMEN EJECUTIVO ═══
        pdf.setTextColor(30, 41, 59); // slate-800
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('📊 Resumen Ejecutivo', 15, yPosition);
        yPosition += 10;

        // KPI Cards
        const kpiStartY = yPosition;

        // Card 1: Ocupación Global
        drawKpiCard(pdf, 15, kpiStartY, 60, 30, 'Tiempo Imputado vs Pres.', `${globalStats.totalImputed.toFixed(1)}h`, `${globalStats.totalCovered.toFixed(1)}h Cub. / ${globalStats.totalPresence.toFixed(1)}h Pres.`, [79, 70, 229]);

        // Card 2: Hueco de Tiempo
        drawKpiCard(pdf, 80, kpiStartY, 60, 30, 'Hueco de Tiempo', `${globalStats.totalGap.toFixed(1)}h`, 'Presencia sin cubrir', [220, 38, 38]);

        // Card 3: Eficiencia Media
        drawKpiCard(pdf, 145, kpiStartY, 50, 30, 'Eficiencia Media', `${globalStats.avgEfficiency.toFixed(1)}h`, 'Por operario', [5, 150, 105]);

        yPosition = kpiStartY + 35;

        // Gráfico de Donut (Simulado con círculos)
        if (yPosition + 50 < 270) {
            pdf.setFontSize(12);
            pdf.setFont('helvetica', 'bold');
            pdf.text('Distribución de Tiempo', 15, yPosition);
            yPosition += 10;

            const centerX = 105;
            const centerY = yPosition + 20;
            const outerRadius = 15;
            const innerRadius = 10;

            // Círculo externo (Total)
            pdf.setFillColor(226, 232, 240); // slate-200
            pdf.circle(centerX, centerY, outerRadius, 'F');

            // Segmento cubierto (Ocupación)
            const occupancyAngle = (globalStats.occupancy / 100) * 360;
            pdf.setFillColor(79, 70, 229); // indigo-600
            drawArc(pdf, centerX, centerY, outerRadius, 0, occupancyAngle);

            // Círculo interno (para efecto donut)
            pdf.setFillColor(255, 255, 255);
            pdf.circle(centerX, centerY, innerRadius, 'F');

            // Porcentaje en el centro
            pdf.setFontSize(16);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(30, 41, 59);
            pdf.text(`${globalStats.occupancy.toFixed(0)}%`, centerX, centerY + 2, { align: 'center' });

            // Leyenda
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'normal');

            // Cubierto
            pdf.setFillColor(79, 70, 229);
            pdf.rect(centerX + 25, centerY - 10, 4, 4, 'F');
            pdf.text(`Cubierto: ${globalStats.totalCovered.toFixed(1)}h`, centerX + 31, centerY - 7);

            // Hueco
            pdf.setFillColor(226, 232, 240);
            pdf.rect(centerX + 25, centerY - 2, 4, 4, 'F');
            pdf.text(`Hueco: ${globalStats.totalGap.toFixed(1)}h`, centerX + 31, centerY + 1);

            yPosition = centerY + 30;
        }

        // ═══ DETALLE POR EMPLEADO ═══
        if (includeEmployeeDetails && employeeData.length > 0) {
            // Nueva página si es necesario
            if (yPosition > 230) {
                pdf.addPage();
                yPosition = 20;
            }

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(30, 41, 59);
            pdf.text('👥 Detalle por Operario', 15, yPosition);
            yPosition += 8;

            // Tabla de empleados
            const tableData = employeeData.map(emp => [
                `FV${emp.operario.toString().padStart(3, '0')}`,
                emp.nombre,
                `${emp.totalPresence.toFixed(1)}h`,
                `${emp.totalJobTimeProduced.toFixed(1)}h`,
                `${emp.totalCovered.toFixed(1)}h`,
                `${emp.timeGap.toFixed(1)}h`,
                `${(emp.overlapRatio * 100).toFixed(0)}%`
            ]);

            autoTable(pdf, {
                startY: yPosition,
                head: [['ID', 'Operario', 'Presencia', 'T. Imputado', 'T. Cubierto', 'Hueco', 'Coef. Multitask']],
                body: tableData,
                theme: 'striped',
                headStyles: {
                    fillColor: [79, 70, 229],
                    textColor: 255,
                    fontStyle: 'bold',
                    fontSize: 9
                },
                bodyStyles: {
                    fontSize: 8,
                    textColor: [51, 65, 85]
                },
                alternateRowStyles: {
                    fillColor: [248, 250, 252]
                },
                columnStyles: {
                    0: { cellWidth: 15, fontStyle: 'bold' },
                    1: { cellWidth: 45 },
                    2: { cellWidth: 20, halign: 'right' },
                    3: { cellWidth: 25, halign: 'right' },
                    4: { cellWidth: 25, halign: 'right' },
                    5: { cellWidth: 20, halign: 'right' },
                    6: { cellWidth: 20, halign: 'right', fontStyle: 'bold' }
                },
                didDrawCell: (data) => {
                    // Colorear fila si multitask > 105%
                    if (data.column.index === 6 && data.section === 'body') {
                        const rowRatio = employeeData[data.row.index].overlapRatio;
                        if (rowRatio > 1.05) {
                            pdf.setTextColor(79, 70, 229); // indigo-600
                            pdf.setFontSize(8);
                            pdf.setFont('helvetica', 'bold');
                            pdf.text(data.cell.text[0], data.cell.x + data.cell.width - 2, data.cell.y + 5, { align: 'right' });
                        }
                    }
                }
            });
        }

        // ═══ FOOTER ═══
        const pageCount = pdf.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'italic');
            pdf.setTextColor(148, 163, 184); // slate-400

            pdf.text(
                `Generado: ${new Date().toLocaleString('es-ES')}`,
                15,
                pdf.internal.pageSize.getHeight() - 10
            );

            pdf.text(
                `Página ${i} de ${pageCount}`,
                pdf.internal.pageSize.getWidth() - 40,
                pdf.internal.pageSize.getHeight() - 10
            );

            if (watermark) {
                pdf.setTextColor(220, 220, 220);
                pdf.setFontSize(50);
                pdf.text(watermark, 105, 150, {
                    align: 'center',
                    angle: 45,
                });
            }
        }

        // Guardar
        const deptName = department === 'all' ? 'Todos' : department.replace(/\s+/g, '_');
        const filename = `Auditoria_Trabajos_${deptName}_${startDate}_${endDate}.pdf`;
        pdf.save(filename);

        logger.success('✅ Reporte PDF generado correctamente');
    } catch (error) {
        logger.error('❌ Error generando reporte PDF:', error);
        throw error;
    }
}

/**
 * Exportar Ranking de Improductivos a PDF
 */
export async function exportImproductiveRankingToPDF(
    rankingRows: ImproductiveRankingRow[],
    options: ReportOptions
): Promise<void> {
    try {
        const { startDate, endDate, department, watermark } = options;

        const pdf = new jsPDF('p', 'mm', 'a4');
        let yPosition = 20;

        // ═══ HEADER ═══
        pdf.setFillColor(217, 119, 6); // amber-600
        pdf.rect(0, 0, 210, 40, 'F');

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(20);
        pdf.setFont('helvetica', 'bold');
        pdf.text('RANKING DE IMPRODUCTIVOS', 105, 16, { align: 'center' });

        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Periodo: ${formatDate(startDate)} - ${formatDate(endDate)}`, 105, 26, { align: 'center' });
        pdf.text(`Departamento: ${department === 'all' ? 'Todos' : department}`, 105, 33, { align: 'center' });

        yPosition = 55;

        const totalImproductive = rankingRows.reduce((acc, row) => acc + row.improductiveHours, 0);
        const employeesWithImproductive = rankingRows.filter(r => r.improductiveHours > 0).length;
        const avgImproductive = employeesWithImproductive > 0 ? totalImproductive / employeesWithImproductive : 0;

        // ═══ KPI CARDS ═══
        drawKpiCard(pdf, 15, yPosition, 60, 30, 'Total Improductivo', `${totalImproductive.toFixed(1)}h`, 'Periodo seleccionado', [217, 119, 6]);
        drawKpiCard(pdf, 80, yPosition, 60, 30, 'Operarios afectados', `${employeesWithImproductive}`, 'Con improductivos', [239, 68, 68]);
        drawKpiCard(pdf, 145, yPosition, 50, 30, 'Media', `${avgImproductive.toFixed(1)}h`, 'Por operario', [6, 95, 70]);

        yPosition += 40;

        const tableData = rankingRows.map((row, idx) => [
            String(idx + 1),
            `FV${row.operario.toString().padStart(3, '0')}`,
            row.nombre,
            row.departamento,
            `${row.improductiveHours.toFixed(2)}h`,
            `${row.improductivePercent.toFixed(1)}%`,
            `${row.totalPresence.toFixed(2)}h`
        ]);

        autoTable(pdf, {
            startY: yPosition,
            head: [['#', 'ID', 'Operario', 'Dept.', 'Improductivo', '% Presencia', 'Presencia']],
            body: tableData,
            theme: 'striped',
            headStyles: {
                fillColor: [217, 119, 6],
                textColor: 255,
                fontStyle: 'bold',
                fontSize: 9
            },
            bodyStyles: {
                fontSize: 8,
                textColor: [51, 65, 85]
            },
            alternateRowStyles: {
                fillColor: [255, 251, 235]
            },
            columnStyles: {
                0: { cellWidth: 10, halign: 'right', fontStyle: 'bold' },
                1: { cellWidth: 20, fontStyle: 'bold' },
                2: { cellWidth: 50 },
                3: { cellWidth: 25 },
                4: { cellWidth: 25, halign: 'right' },
                5: { cellWidth: 25, halign: 'right' },
                6: { cellWidth: 20, halign: 'right' }
            }
        });

        const pageCount = pdf.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);
            pdf.setFontSize(8);
            pdf.setFont('helvetica', 'italic');
            pdf.setTextColor(148, 163, 184);

            pdf.text(
                `Generado: ${new Date().toLocaleString('es-ES')}`,
                15,
                pdf.internal.pageSize.getHeight() - 10
            );

            pdf.text(
                `Página ${i} de ${pageCount}`,
                pdf.internal.pageSize.getWidth() - 40,
                pdf.internal.pageSize.getHeight() - 10
            );

            if (watermark) {
                pdf.setTextColor(220, 220, 220);
                pdf.setFontSize(50);
                pdf.text(watermark, 105, 150, {
                    align: 'center',
                    angle: 45,
                });
            }
        }

        const deptName = department === 'all' ? 'Todos' : department.replace(/\s+/g, '_');
        const filename = `Ranking_Improductivos_${deptName}_${startDate}_${endDate}.pdf`;
        pdf.save(filename);
        logger.success('✅ Ranking de improductivos exportado correctamente');
    } catch (error) {
        logger.error('❌ Error exportando ranking de improductivos:', error);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function drawArc(
    pdf: jsPDF,
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number
): void {
    // Convertir ángulos a radianes
    const start = (startAngle - 90) * Math.PI / 180;
    const end = (endAngle - 90) * Math.PI / 180;

    // Dibujar arco usando líneas
    const steps = Math.ceil(Math.abs(endAngle - startAngle) / 5);
    const angleStep = (end - start) / steps;

    pdf.lines([[0, 0]], x, y);

    for (let i = 0; i <= steps; i++) {
        const angle = start + (angleStep * i);
        const px = radius * Math.cos(angle);
        const py = radius * Math.sin(angle);
        pdf.line(x, y, x + px, y + py);
    }
}

function formatDate(dateStr: string): string {
    try {
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    } catch (error) {
        logger.warn('No se pudo formatear fecha en jobAuditExportService', {
            source: 'jobAuditExportService.formatDate',
            dateStr,
            reason: error
        });
        return dateStr;
    }
}

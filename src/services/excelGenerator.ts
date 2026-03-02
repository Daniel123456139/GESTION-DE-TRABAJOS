import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { DepartmentGroup, ImproductiveRow } from '../hooks/useImproductiveReport';
import { isAssumedImproductiveArticle, isEmbalajeImproductiveArticle } from '../data/improductiveArticles';

type ExportColumn = { header: string; key: string; width: number };
type ArticleCategory = 'regular' | 'assumed' | 'embalaje';

const articleColumnKey = (articleId: string) => `art_${articleId}`;

const normalizeDepartment = (value: string): string => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const isAlmacenDepartment = (departmentName: string): boolean => {
    const normalized = normalizeDepartment(departmentName);
    return normalized.includes('ALMACEN') || normalized === 'ALM' || normalized.startsWith('ALM ');
};

const getArticleCategory = (articleId: string): ArticleCategory => {
    if (isEmbalajeImproductiveArticle(articleId)) return 'embalaje';
    if (isAssumedImproductiveArticle(articleId)) return 'assumed';
    return 'regular';
};

const headerColorByCategory: Record<ArticleCategory, string> = {
    regular: 'FFFFCC99',
    assumed: 'FFD9F2D9',
    embalaje: 'FFFFCCE5'
};

const totalColorByCategory: Record<ArticleCategory, string> = {
    regular: 'FFFFFF00',
    assumed: 'FFCCFFCC',
    embalaje: 'FFFF99CC'
};

const buildColumns = (articleIds: string[]): ExportColumn[] => {
    const columns: ExportColumn[] = [
        { header: 'OPERARIO', key: 'operario', width: 12 },
        { header: 'NOMBRE_OPERARIO', key: 'nombre', width: 35 },
        { header: 'TOTAL', key: 'total', width: 12 }
    ];

    articleIds.forEach((articleId) => {
        columns.push({ header: articleId, key: articleColumnKey(articleId), width: 15 });
    });

    columns.push(
        { header: 'Improd', key: 'improd', width: 12 },
        { header: 'Prod', key: 'prod', width: 12 },
        { header: '% Improd', key: 'percent', width: 12 },
        { header: 'Descripcion (Seccion)', key: 'desc', width: 30 }
    );

    return columns;
};

const applyHeaderStyle = (
    worksheet: ExcelJS.Worksheet,
    columns: ExportColumn[],
    articleCategoryByColumnKey: Map<string, ArticleCategory>
) => {
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, name: 'Arial' };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    headerRow.eachCell((cell, colNumber) => {
        const col = columns[colNumber - 1];

        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };

        if (col?.key?.startsWith('art_')) {
            const category = articleCategoryByColumnKey.get(col.key) || 'regular';
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: headerColorByCategory[category] }
            };
            return;
        }

        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFEEEEEE' }
        };
    });
};

const applyNumericAndBorderStyle = (row: ExcelJS.Row, columns: ExportColumn[]) => {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const col = columns[colNumber - 1];
        if (!col) return;

        cell.font = { name: 'Arial', size: 10 };

        if (col.key === 'percent') {
            cell.numFmt = '0.00%';
        } else if (['total', 'improd', 'prod'].includes(col.key) || col.key.startsWith('art_')) {
            cell.numFmt = '0.00';
        }

        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });
};

const buildEmployeeRowData = (
    emp: ImproductiveRow,
    departmentName: string,
    articleIds: string[]
) => {
    const total = emp.totalHours;
    let filteredImprod = 0;

    const rowData: Record<string, string | number> = {
        operario: emp.operatorId,
        nombre: emp.operatorName,
        total: Number(total.toFixed(2)),
        desc: departmentName
    };

    articleIds.forEach((articleId) => {
        const value = emp.breakdown[articleId] || 0;
        filteredImprod += value;
        rowData[articleColumnKey(articleId)] = Number(value.toFixed(2));
    });

    const productive = Math.max(0, total - filteredImprod);

    rowData.improd = Number(filteredImprod.toFixed(2));
    rowData.prod = Number(productive.toFixed(2));
    rowData.percent = total > 0 ? filteredImprod / total : 0;

    return {
        rowData,
        total,
        filteredImprod,
        productive
    };
};

const addImproductiveSheet = (
    workbook: ExcelJS.Workbook,
    sheetName: string,
    data: DepartmentGroup[],
    articleIds: string[]
) => {
    const worksheet = workbook.addWorksheet(sheetName, {
        views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }]
    });

    const columns = buildColumns(articleIds);
    const articleCategoryByColumnKey = new Map<string, ArticleCategory>(
        articleIds.map((articleId) => [articleColumnKey(articleId), getArticleCategory(articleId)])
    );

    worksheet.columns = columns;
    applyHeaderStyle(worksheet, columns, articleCategoryByColumnKey);

    let grandTotalHours = 0;
    let grandTotalImproductive = 0;
    let grandTotalProductive = 0;
    const grandTotalBreakdown: Record<string, number> = {};

    data.forEach((group) => {
        const sectionTotals = {
            totalHours: 0,
            improductiveHours: 0,
            productiveHours: 0,
            breakdown: {} as Record<string, number>
        };

        group.rows.forEach((emp) => {
            const { rowData, total, filteredImprod, productive } = buildEmployeeRowData(emp, group.departmentName, articleIds);
            const row = worksheet.addRow(rowData);
            applyNumericAndBorderStyle(row, columns);

            sectionTotals.totalHours += total;
            sectionTotals.improductiveHours += filteredImprod;
            sectionTotals.productiveHours += productive;

            articleIds.forEach((articleId) => {
                const value = emp.breakdown[articleId] || 0;
                sectionTotals.breakdown[articleId] = (sectionTotals.breakdown[articleId] || 0) + value;
                grandTotalBreakdown[articleId] = (grandTotalBreakdown[articleId] || 0) + value;
            });
        });

        const sectionRowData: Record<string, string | number> = {
            operario: '',
            nombre: `TOTAL SECCION ${group.departmentName}`,
            total: Number(sectionTotals.totalHours.toFixed(2)),
            improd: Number(sectionTotals.improductiveHours.toFixed(2)),
            prod: Number(sectionTotals.productiveHours.toFixed(2)),
            percent: sectionTotals.totalHours > 0 ? sectionTotals.improductiveHours / sectionTotals.totalHours : 0,
            desc: ''
        };

        articleIds.forEach((articleId) => {
            sectionRowData[articleColumnKey(articleId)] = Number((sectionTotals.breakdown[articleId] || 0).toFixed(2));
        });

        const sectionRow = worksheet.addRow(sectionRowData);
        sectionRow.font = { bold: true, name: 'Arial' };
        sectionRow.eachCell((cell, colNumber) => {
            const col = columns[colNumber - 1];
            if (!col) return;

            const category = col.key.startsWith('art_')
                ? (articleCategoryByColumnKey.get(col.key) || 'regular')
                : null;

            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: category ? totalColorByCategory[category] : 'FFECECEC' }
            };
            cell.border = {
                top: { style: 'medium' },
                left: { style: 'thin' },
                bottom: { style: 'medium' },
                right: { style: 'thin' }
            };

            cell.font = { bold: true, name: 'Arial', size: 10 };
            if (col.key === 'percent') cell.numFmt = '0.00%';
            if (['total', 'improd', 'prod'].includes(col.key) || col.key.startsWith('art_')) cell.numFmt = '0.00';
        });

        grandTotalHours += sectionTotals.totalHours;
        grandTotalImproductive += sectionTotals.improductiveHours;
        grandTotalProductive += sectionTotals.productiveHours;
    });

    const grandTotalRowData: Record<string, string | number> = {
        operario: '',
        nombre: 'TOTAL GENERAL',
        total: Number(grandTotalHours.toFixed(2)),
        improd: Number(grandTotalImproductive.toFixed(2)),
        prod: Number(grandTotalProductive.toFixed(2)),
        percent: grandTotalHours > 0 ? grandTotalImproductive / grandTotalHours : 0,
        desc: ''
    };

    articleIds.forEach((articleId) => {
        grandTotalRowData[articleColumnKey(articleId)] = Number((grandTotalBreakdown[articleId] || 0).toFixed(2));
    });

    const grandTotalRow = worksheet.addRow(grandTotalRowData);
    grandTotalRow.font = { bold: true, size: 12, name: 'Arial' };
    grandTotalRow.eachCell((cell, colNumber) => {
        const col = columns[colNumber - 1];
        if (!col) return;

        const category = col.key.startsWith('art_')
            ? (articleCategoryByColumnKey.get(col.key) || 'regular')
            : null;

        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: category ? totalColorByCategory[category] : 'FFFFA500' }
        };
        cell.border = {
            top: { style: 'thick' },
            left: { style: 'thick' },
            bottom: { style: 'thick' },
            right: { style: 'thick' }
        };

        cell.font = { bold: true, size: 12, name: 'Arial' };
        if (col.key === 'percent') cell.numFmt = '0.00%';
        if (['total', 'improd', 'prod'].includes(col.key) || col.key.startsWith('art_')) cell.numFmt = '0.00';
    });
};

const addAnalysisSheet = (
    workbook: ExcelJS.Workbook,
    data: DepartmentGroup[]
) => {
    const worksheet = workbook.addWorksheet('ANALISIS', {
        views: [{ state: 'frozen', ySplit: 1, xSplit: 0 }]
    });

    worksheet.columns = [
        { header: 'SECCION', key: 'seccion', width: 25 },
        { header: 'OPERARIO', key: 'operario', width: 15 },
        { header: 'NOMBRE', key: 'nombre', width: 35 },
        { header: 'PRODUCTIVO ERP', key: 'productivo', width: 20 },
        { header: 'TOTAL HORAS', key: 'total', width: 15 },
        { header: 'IMPRODUCTIVAS', key: 'improd', width: 15 },
        { header: '% IMPROD', key: 'percent', width: 15 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };

    data.forEach(group => {
        group.rows.forEach(emp => {
            const row = worksheet.addRow({
                seccion: group.departmentName,
                operario: emp.operatorId,
                nombre: emp.operatorName,
                productivo: emp.isProductive ? 'SI' : 'NO',
                total: emp.totalHours,
                improd: emp.improductiveHours,
                percent: emp.totalHours > 0 ? emp.improductiveHours / emp.totalHours : 0
            });
            
            row.getCell('productivo').font = { 
                color: { argb: emp.isProductive ? 'FF000000' : 'FF9C0006' },
                bold: !emp.isProductive
            };
            row.getCell('percent').numFmt = '0.00%';
            row.getCell('total').numFmt = '0.00';
            row.getCell('improd').numFmt = '0.00';
            
            if (!emp.isProductive) {
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
            }
        });
    });
};

export const generateImproductivosExcel = async (
    data: DepartmentGroup[],
    allArticleIds: string[],
    dateRange: { start: string; end: string }
) => {
    const workbook = new ExcelJS.Workbook();

    const assumedArticleIds = allArticleIds.filter((id) => isAssumedImproductiveArticle(id));
    const regularArticleIds = allArticleIds.filter((id) => !isAssumedImproductiveArticle(id));
    const almacenOnlyData = data.filter((group) => isAlmacenDepartment(group.departmentName));

    addImproductiveSheet(workbook, 'Improductivos', data, regularArticleIds);
    addImproductiveSheet(workbook, 'Impr Asumidos', data, assumedArticleIds);
    addImproductiveSheet(workbook, 'ALMACEN', almacenOnlyData, allArticleIds);
    addAnalysisSheet(workbook, data);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    const fileName = `IMPRODUCTIVOS_${dateRange.start}_${dateRange.end}.xlsx`;
    saveAs(blob, fileName);
};

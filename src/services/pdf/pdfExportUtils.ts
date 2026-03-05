import { saveAs } from 'file-saver';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;
export const PAGE_MARGIN = 36;

export interface PdfFonts {
    regular: PDFFont;
    bold: PDFFont;
    italic: PDFFont;
}

export async function createPdfBundle(): Promise<{ pdfDoc: PDFDocument; fonts: PdfFonts }> {
    const pdfDoc = await PDFDocument.create();
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    return {
        pdfDoc,
        fonts: { regular, bold, italic }
    };
}

export function addA4Page(pdfDoc: PDFDocument): PDFPage {
    return pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
}

export function sanitizePdfText(value: string): string {
    if (!value) return '';

    const normalized = value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return normalized.replace(/[^\x20-\x7E]/g, '');
}

export function drawCenteredText(
    page: PDFPage,
    font: PDFFont,
    text: string,
    y: number,
    size: number,
    color = rgb(0, 0, 0)
): void {
    const safeText = sanitizePdfText(text);
    const width = font.widthOfTextAtSize(safeText, size);
    page.drawText(safeText, {
        x: (A4_WIDTH - width) / 2,
        y,
        size,
        font,
        color
    });
}

export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
    const safeText = sanitizePdfText(text);
    if (!safeText) return [''];

    const words = safeText.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, size);

        if (testWidth <= maxWidth || !currentLine) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }

    if (currentLine) lines.push(currentLine);
    return lines.length ? lines : [''];
}

export function drawWrappedText(
    page: PDFPage,
    font: PDFFont,
    text: string,
    x: number,
    y: number,
    size: number,
    maxWidth: number,
    lineHeight: number,
    color = rgb(0, 0, 0)
): number {
    const lines = wrapText(font, text, size, maxWidth);
    let cursorY = y;

    for (const line of lines) {
        page.drawText(line, { x, y: cursorY, size, font, color });
        cursorY -= lineHeight;
    }

    return cursorY;
}

export async function savePdfFile(pdfDoc: PDFDocument, fileName: string): Promise<void> {
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    saveAs(blob, fileName);
}

export function addStandardFooter(
    page: PDFPage,
    fonts: PdfFonts,
    pageNumber: number,
    pageCount: number,
    timestamp: string,
    watermark?: string
): void {
    const footerY = PAGE_MARGIN - 14;

    page.drawText(sanitizePdfText(`Generado: ${timestamp}`), {
        x: PAGE_MARGIN,
        y: footerY,
        size: 8,
        font: fonts.italic,
        color: rgb(0.45, 0.45, 0.45)
    });

    page.drawText(`Pagina ${pageNumber} de ${pageCount}`, {
        x: A4_WIDTH - PAGE_MARGIN - 70,
        y: footerY,
        size: 8,
        font: fonts.italic,
        color: rgb(0.45, 0.45, 0.45)
    });

    if (watermark) {
        drawCenteredText(
            page,
            fonts.bold,
            watermark,
            A4_HEIGHT / 2,
            36,
            rgb(0.86, 0.86, 0.86)
        );
    }
}

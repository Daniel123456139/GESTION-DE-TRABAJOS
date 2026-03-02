
import { GoogleGenAI } from "@google/genai";
import { RawDataRow } from "../types";
import { getGeminiClientApiKey, getGeminiDisabledMessage } from '../config/aiConfig';
import { logError, logWarning } from '../utils/logger';

const apiKey = getGeminiClientApiKey();
// Initialize only if key exists to prevent immediate crash, handle missing key inside functions
const ai = apiKey ? new GoogleGenAI({ apiKey: apiKey }) : null;

export const getGeminiAnalysis = async (filteredRawData: RawDataRow[], motivos: { IDMotivo: string; DescMotivo: string }[]): Promise<string> => {
    if (!ai) {
        return `⚠️ ${getGeminiDisabledMessage()}`;
    }

    const motivosList = motivos.map(m => `- ID ${m.IDMotivo}: ${m.DescMotivo}`).join('\n');

    try {
        const systemInstruction = `Actúas como un analista experto en Recursos Humanos. Tu tarea es analizar los datos de fichajes proporcionados y generar un informe estructurado y claro en formato Markdown.

**Contexto - Códigos de Incidencia Definidos en ERP:**
${motivosList}

**Formato de Datos de Entrada:**
Los datos se proporcionan en un objeto JSON con dos claves:
- \`headers\`: Un array con los nombres de las columnas (ej: ["IDOperario", "Fecha", "Hora", ...]).
- \`rows\`: Un array de arrays, donde cada array interno es una fila y sus valores se corresponden en orden con las \`headers\`.

**Reglas de Análisis Obligatorias:**

0.  **ID de Operario Obligatorio:** TODAS y cada una de las tablas en el informe final DEBEN incluir la columna 'ID Operario' como primera columna.
1.  **Jornada Laboral Estándar:** La jornada de referencia es de 8 horas.
2.  **Análisis de Duración de Jornada:**
    *   **Jornadas > 8h:** Identifica los días en que un empleado trabaja más de 8 horas. Desglosa el tiempo en 'Jornada Regular' (siempre 8.00h), 'Exceso' y 'Total Trabajado'.
    *   **Jornadas < 8h:** Identifica los días en que un empleado trabaja menos de 8 horas. Indica si la justificación está pendiente.
3.  **Análisis de Retrasos:**
    *   El turno de mañana (M) comienza a las 07:00.
    *   Existe un margen de cortesía de 1 minuto y 59 segundos.
    *   Cualquier fichaje de entrada (Entrada=1) a partir de las 07:02:00 se considera un retraso.
4.  **Análisis de Ausencias y Bajas:**
    *   **Ausencias:** Lista todas las ausencias registradas donde Entrada es 0 y el Motivo es computable.
    *   **Tipificación:** Usa la lista de códigos de incidencia provista para identificar el tipo de ausencia.
5.  **Análisis de Jornadas Partidas:**
    *   Una jornada partida ocurre cuando un empleado ficha 'FIN DE JORNADA' y vuelve a fichar una entrada en el mismo día.
    *   Identifica estos casos y calcula la duración de la interrupción.

**Reglas de Estructura del Informe (CRÍTICO):**

Debes analizar los datos **DÍA POR DÍA**. Si el periodo abarca más de un día, genera una sección separada para cada fecha.
Analiza primero un día completo, presenta sus tablas, y luego pasa al siguiente día.

**Estructura de Salida Requerida (Repetir para CADA FECHA encontrada en orden cronológico):**

# Informe del [Día de la semana] [DD-MM-YYYY]

## ✅ Jornadas Superiores a 8 Horas (Solo si existen en este día)
| ID Operario | Empleado | Jornada Regular | Exceso | Total Trabajado |
|---|---|---|---|---|
| [ID] | [Nombre] | 8.00 h | [X.XX h] | [Y.YY h] |

## ⚠️ Jornadas Inferiores a 8 Horas (Solo si existen en este día)
| ID Operario | Empleado | Horas Trabajadas | Justificación |
|---|---|---|---|
| [ID] | [Nombre] | [X.XX h] | Pendiente |

## 🕒 Retrasos Registrados (Solo si existen en este día)
| ID Operario | Empleado | Hora de Entrada | Retraso |
|---|---|---|---|
| [ID] | [Nombre] | [HH:MM] | [X minutos] |

## 📋 Incidencias, Ausencias y Bajas (Solo si existen en este día)
| ID Operario | Empleado | Tipo | Detalle |
|---|---|---|---|
| [ID] | [Nombre] | [Tipo] | [Descripción] |

---

**Nota Final:**
*   Si un día no tiene incidencias de ningún tipo, indica bajo el encabezado de la fecha: "Sin incidencias relevantes registradas." y no generes tablas vacías.
*   NO incluyas ninguna etiqueta HTML.
*   Basa tu análisis únicamente en los datos proporcionados.`;

        if (filteredRawData.length === 0) {
            return "No hay datos para analizar. El archivo puede estar vacío o no contener registros válidos.";
        }

        // OPTIMIZATION: Strictly limit data to prevent 500 errors.
        const MAX_ROWS = 200;
        let dataToSend = filteredRawData;
        let truncatedMsg = "";

        if (filteredRawData.length > MAX_ROWS) {
            // 1. Sort descending to get the MOST RECENT records first for truncation
            const recentRows = [...filteredRawData]
                .sort((a, b) => b.Fecha.localeCompare(a.Fecha) || b.Hora.localeCompare(a.Hora))
                .slice(0, MAX_ROWS);

            // 2. Re-sort ASCENDING (Chronological) for the LLM analysis so it reads "Day 1 then Day 2"
            dataToSend = recentRows.sort((a, b) => a.Fecha.localeCompare(b.Fecha) || a.Hora.localeCompare(b.Hora));

            truncatedMsg = `\n\n*Nota: El análisis se ha limitado a los últimos ${MAX_ROWS} registros para garantizar la estabilidad del servicio.*`;
        } else {
            // Sort full dataset chronologically
            dataToSend = [...filteredRawData].sort((a, b) => a.Fecha.localeCompare(b.Fecha) || a.Hora.localeCompare(b.Hora));
        }

        // Only send necessary columns to reduce token count
        const essentialHeaders: (keyof RawDataRow)[] = ['IDOperario', 'DescOperario', 'Fecha', 'Hora', 'Entrada', 'MotivoAusencia', 'DescMotivoAusencia', 'TurnoTexto'];
        const rows = dataToSend.map(row => essentialHeaders.map(header => row[header]));

        const compactData = {
            headers: essentialHeaders,
            rows
        };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Por favor, analiza los siguientes datos brutos de fichajes día por día:\n${JSON.stringify(compactData)}`,
            config: {
                systemInstruction: systemInstruction,
            },
        });

        return response.text + truncatedMsg;
    } catch (error) {
        logError("Error generating Gemini analysis:", error);
        if (error instanceof Error && (error.message.includes('token') || (error as any).cause?.message?.includes('token'))) {
            throw new Error("El archivo proporcionado es demasiado grande para ser procesado por la IA. Por favor, reduce el rango de fechas.");
        }
        throw new Error("No se pudo generar el análisis de IA en este momento. Verifica tu API Key o conexión.");
    }
};

export const analyzeImage = async (prompt: string, base64Data: string, mimeType: string): Promise<string> => {
    if (!ai) return "Error: API Key no configurada.";
    try {
        const imagePart = {
            inlineData: {
                data: base64Data,
                mimeType: mimeType,
            },
        };

        const textPart = {
            text: prompt,
        };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, textPart] },
        });

        return response.text || "No se pudo analizar la imagen.";
    } catch (error) {
        logError("Error analyzing image:", error);
        throw new Error("Failed to analyze image with Gemini API.");
    }
};

export interface BlogPostGeneratedData {
    title: string;
    summary: string;
    content: string;
    tags: string[];
    author: string;
}

export const generateBlogPost = async (topic: string): Promise<BlogPostGeneratedData> => {
    if (!ai) throw new Error("API Key no configurada.");

    const blogSystemInstruction = `
1. Contexto
El blog forma parte de la misma app que gestiona la presencia del personal, por lo que debe integrarse natural y coherentemente con el sistema.

2. Objetivo general
Crear contenido útil, claro y relevante para los empleados.

FORMATO DE SALIDA OBLIGATORIO:
Devuelve EXCLUSIVAMENTE un objeto JSON válido con: title, summary, content (markdown), tags, author.
`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Genera una noticia interna sobre: "${topic}"`,
            config: {
                systemInstruction: blogSystemInstruction,
                responseMimeType: 'application/json',
            },
        });

        const text = response.text;
        if (!text) throw new Error("La IA no devolvió respuesta.");

        return JSON.parse(text) as BlogPostGeneratedData;
    } catch (error) {
        logError("Error generating blog post:", error);
        throw new Error("Error al generar el contenido del blog.");
    }
};

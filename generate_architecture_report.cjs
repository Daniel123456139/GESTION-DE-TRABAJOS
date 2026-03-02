'use strict';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat
} = require('docx');
const fs = require('fs'), path = require('path');

const DARK_BLUE="1F4E79", TH_BG="2E75B6", CODE_BG="F2F2F2", ALT="EBF3FA", GREEN="E2EFDA", YELLOW="FFF9E6";
const bdr={style:BorderStyle.SINGLE,size:1,color:"CCCCCC"}, bdrs={top:bdr,bottom:bdr,left:bdr,right:bdr}, mg={top:80,bottom:80,left:120,right:120};
const TODAY="02/03/2026";

function h1(t){return new Paragraph({heading:HeadingLevel.HEADING_1,spacing:{before:360,after:200},children:[new TextRun({text:t,bold:true,size:32,font:"Arial",color:DARK_BLUE})]})}
function h2(t){return new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:280,after:140},children:[new TextRun({text:t,bold:true,size:26,font:"Arial",color:DARK_BLUE})]})}
function h3(t){return new Paragraph({heading:HeadingLevel.HEADING_3,spacing:{before:200,after:100},children:[new TextRun({text:t,bold:true,size:22,font:"Arial",color:DARK_BLUE})]})}
function p(t,o={}){return new Paragraph({spacing:{after:120},children:[new TextRun({text:String(t||""),font:"Arial",size:22,...o})]})}
function bl(t){return new Paragraph({numbering:{reference:"bullets",level:0},spacing:{after:80},children:[new TextRun({text:String(t||""),font:"Arial",size:22})]})}
function pb(){return new Paragraph({children:[new PageBreak()]})}
function ep(){return new Paragraph({spacing:{after:80},children:[new TextRun("")]})}

function th(t,w){return new TableCell({borders:bdrs,width:{size:w,type:WidthType.DXA},shading:{fill:TH_BG,type:ShadingType.CLEAR},margins:mg,verticalAlign:VerticalAlign.CENTER,children:[new Paragraph({alignment:AlignmentType.CENTER,children:[new TextRun({text:String(t||""),bold:true,font:"Arial",size:20,color:"FFFFFF"})]})]})}
function td(t,w,alt,bold,bg){
  const fill=bg||(alt?ALT:"FFFFFF");
  return new TableCell({
    borders:bdrs,width:{size:w,type:WidthType.DXA},shading:{fill:fill,type:ShadingType.CLEAR},margins:mg,
    children:[new Paragraph({children:[new TextRun({text:String(t||""),font:"Arial",size:20,bold:!!bold})]})]
  });
}

function makeConfigTable() {
  const cols = [2200, 2200, 2200, 2500];
  const data = [
    ["Característica", "APP PRESENCIA", "APP GESTIÓN TRABAJOS", "APP TALENTO"],
    ["ID Proyecto", "app-presencia", "app-presencia", "app-presencia"],
    ["Configuración", "VITE_FIREBASE_*", "VITE_FIREBASE_*", "VITE_FIREBASE_*"],
    ["Región", "eu-southwest1", "eu-southwest1", "eu-southwest1"],
    ["SDK Versión", "^12.6.0", "^12.6.0", "^12.8.0"],
    ["Persistencia", "persistentLocalCache", "persistentLocalCache", "IndexedDB Persistence"],
    ["Uso Firestore", "Alta (Fichajes)", "Media (Supervisión)", "Alta (Evaluación)"],
    ["Uso Storage", "Adjuntos Incidencias", "Adjuntos Trabajos", "Adjuntos Empleados"]
  ];
  return new Table({
    width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: cols,
    rows: data.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: r.map((c, ci) => ri === 0 ? th(c, cols[ci]) : td(c, cols[ci], ri % 2 === 0))
    }))
  });
}

function makeCollectionsTable() {
  const cols = [2000, 1500, 5600];
  const data = [
    ["Colección", "Uso Principal", "Propósito y Relaciones"],
    ["EMPLEADOS_REF", "PRES+GT+TAL", "Maestro de empleados con datos básicos de identificación."],
    ["USUARIOS", "PRES+GT+TAL", "Gestión de accesos y permisos granulares por módulo."],
    ["SICK_LEAVES", "PRES", "Bajas médicas activas. Leída por GT para dashboards."],
    ["BAJAS", "PRES", "Histórico de bajas médicas finalizadas."],
    ["INCIDENT_LOG", "PRES", "Log inmutable de incidencias (Asuntos propios, médico, etc.)."],
    ["APP_PUNCHES", "PRES+GT", "Fichajes sintéticos para cálculos de nómina."],
    ["COMPETENCIAS", "TALENTO", "Evaluaciones de habilidades de los empleados."],
    ["NOTAS", "TALENTO", "Anotaciones de seguimiento y feedback técnico."],
    ["FORMACIONES", "TALENTO", "Registro de cursos y planes formativos."],
    ["TRABAJOS", "GESTOR", "Partes de trabajo realizados en planta."],
    ["CONFIGURACION", "GENERAL", "Variables de entorno y límites operativos del negocio."]
  ];
  return new Table({
    width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: cols,
    rows: data.map((r, ri) => new TableRow({
      tableHeader: ri === 0,
      children: r.map((c, ci) => ri === 0 ? th(c, cols[ci]) : td(c, cols[ci], ri % 2 === 0))
    }))
  });
}

const doc = new Document({
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: "\u2022",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }]
    }]
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA", space: 5 } },
          children: [new TextRun({ text: "Análisis Arquitectura Firebase v3.0 | 3 Aplicaciones  |  Proyecto: app-presencia", font: "Arial", size: 18, color: "666666", italics: true })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { top: { style: BorderStyle.SINGLE, size: 1, color: "AAAAAA", space: 5 } },
          children: [new TextRun({ text: `${TODAY}   |   Página `, font: "Arial", size: 18, color: "666666" }), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 18, color: "666666" })]
        })]
      })
    },
    children: [
      ep(), ep(), ep(), ep(),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "ARQUITECTURA E INTERACCIÓN FIREBASE", bold: true, font: "Arial", size: 52, color: DARK_BLUE })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "SISTEMA UNIFICADO DE DATOS (PRESENCIA, TRABAJOS, TALENTO)", bold: true, font: "Arial", size: 28, color: "2E75B6" })] }),
      ep(),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Fecha del Informe: ${TODAY}`, font: "Arial", size: 22, color: "555555" })] }),
      pb(),

      h1("1. ARQUITECTURA DEL SISTEMA"),
      p("El ecosistema se basa en un proyecto centralizado de Firebase (app-presencia) que actúa como 'Single Source of Truth' para tres aplicaciones independientes. La base de datos Firestore está alojada en la región europe-southwest1, garantizando latencias mínimas para las operaciones en España."),
      p("Esta arquitectura permite que datos críticos, como la identidad de los empleados o los permisos de usuario, se compartan instantáneamente entre los distintos departamentos sin necesidad de APIs intermedias."),
      ep(),
      makeConfigTable(),
      ep(),
      bl("Interacción Inmediata: Los cambios realizados en una app (ej: una evaluación en Talento) son visibles en tiempo real por los supervisores en Gestión Trabajos."),
      bl("Seguridad Compartida: Las reglas de Firestore protegen el acceso globalmente, independientemente de qué aplicación realice la petición."),

      h1("2. FUNCIONAMIENTO POR APLICACIÓN"),
      h2("2.1 APP PRESENCIA"),
      p("Es el motor principal de control de asistencia. Se encarga de la captura de fichajes y la gestión de incidencias temporales."),
      bl("Lógica de Fichajes: Procesa entradas y salidas analizando el horario del operario (Turno Mañana/Tarde)."),
      bl("Cálculo Sintético: Genera la colección APP_GENERATED_PUNCHES, que traduce los fichajes físicos en horas netas trabajadas para nómina."),
      bl("Gestión de Bajas: Permite a los responsables de área registrar avisos de médico o bajas oficiales."),

      h2("2.2 APP GESTIÓN TRABAJOS"),
      p("Orientada a la productividad en planta. Su función es cruzar la presencia física con los trabajos realizados."),
      bl("Partes de Trabajo: Permite registrar en la colección TRABAJOS qué operario ha realizado qué orden de fabricación."),
      bl("Supervisión en Tiempo Real: Muestra quién está presente y quién tiene incidencias activas leyendo las colecciones de Presencia."),

      h2("2.3 APP TALENTO"),
      p("Enfocada en el desarrollo de los recursos humanos. Es la aplicación con mayor carga de escritura de datos cualitativos."),
      bl("Evaluación de Competencias: Permite calificar las habilidades técnicas mediante una matriz compleja en Firestore."),
      bl("Planes Formativos: Gestiona el calendario de cursos y su impacto en el nivel retributivo del empleado."),

      pb(),
      h1("3. INVENTARIO MAESTRO DE DATOS"),
      p("A continuación se detallan las colecciones principales y cómo interactúan con las aplicaciones:"),
      makeCollectionsTable(),
      ep(),
      h2("Hallazgo Clave: Modelo de Permisos Granular"),
      p("El análisis del código revela que los USUARIOS no solo tienen un 'rol' (SUPER_ADMIN, RRHH, etc.), sino un objeto de 'permisos' detallado que permite o deniega acciones específicas por módulo:"),
      p("{ presence: { view: true, edit: false }, talent: { view: true, edit: true } ... }", { italics: true }),

      h1("4. FLUJO DE DATOS Y SINCRONIZACIÓN"),
      p("El sistema utiliza una estrategia 'Offline-First' basada en las capacidades de caché de Firestore:"),
      bl("Caché Local: Las apps mantienen una copia de los datos en IndexedDB, permitiendo que operen sin conexión en entornos industriales con mala cobertura."),
      bl("Sincronización Silenciosa: Cuando se recupera la conexión, el SDK de Firebase envía las escrituras pendientes y recibe actualizaciones vía WebSockets."),
      bl("Traspaso ERP: Los datos maestros (DNI, Email personal) no residen en Firebase por seguridad (GDPR), sino que se consultan a la API local del ERP on-demand."),

      pb(),
      h1("5. CONCLUSIONES PARA MIGRACIÓN"),
      p("Dada la fuerte interacción en tiempo real y la dependencia de las funciones de RLS (Security Rules) de Firestore, el paso a un servidor local requiere:"),
      bl("Reemplazo de WebSockets para mantener el 'onSnapshot' de las evaluaciones."),
      bl("Implementación de un sistema de caché similar para mantener la operatividad offline."),
      p("El sistema actual es altamente cohesivo y eficiente para el flujo de trabajo de la empresa.")
    ]
  }]
});

const outputDir = "C:\\Users\\facturas\\Desktop\\PRUEBAS COMERCIAL";
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
const outPath = path.join(outputDir, "Firebase_Analisis_Arquitectura_20260302.docx");

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log("✅ Documento generado con éxito: " + outPath);
}).catch(err => {
  console.error("❌ Error en la generación:", err);
  process.exit(1);
});

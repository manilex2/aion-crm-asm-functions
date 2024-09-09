require("dotenv").config({path: "./.env"});
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const {
  getFirestore,
  // eslint-disable-next-line no-unused-vars
  DocumentData,
} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const {
  PDFDocument,
  rgb,
  PageSizes,
  // eslint-disable-next-line no-unused-vars
  PDFPage,
} = require("pdf-lib");
const fontkit = require("@pdf-lib/fontkit");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});
const fs = require("fs");

/**
 * Función para crear pdf para cotización del terreno.
 * @param {Request} req Datos de la solicitud HTTP
 * @param {Response} res Respuesta de la solicitud HTTP
 */
const createPdf = async (req, res) => {
  const db = getFirestore();
  try {
    // Obtener las fechas del body
    const {source, lastLeadStatus, logoUrl} = req.body;

    if (!source || !lastLeadStatus || !logoUrl) {
      // eslint-disable-next-line max-len
      throw new Error("BAD REQUEST: No se proporcionaron alguno de estos parámetros: source, lastLeadStatus y/o logoUrl");
    }

    const leadsContactFailData = (await db
        .collection("contactos")
        .where("lastLeadStatus", "==", lastLeadStatus)
        .where("source", "==", source)
        .get())
        .docs.map((leadContact) => {
          return leadContact.data();
        });


    if (leadsContactFailData.length < 1) {
      // eslint-disable-next-line max-len
      throw new Error("NOT FOUND: No se encontraron documentos para los filtros especificados.");
    }

    const resultados = leadsContactFailData.map((row) => ({
      origen: source,
      fecha: formatDate(row.registrationDate) || "",
      nombre: row.names || "",
      apellido: row.surnames || "",
      correo: row.email || "",
      telefono: row.phone || "",
      ultimoSeguimiento: formatDate(row.lastUpdate) || "",
      status: row.status || "",
      comentarios: row.notes || "",
    }));

    // Guardar el PDF en memoria
    const pdfBytes = Buffer
        .from(await generatePDF(resultados, logoUrl));

    const storage = getStorage().bucket("aion-crm-asm.appspot.com");

    // eslint-disable-next-line max-len
    const destination = `pdfs/Leads-no-contactados-${new Date(Date.now())}.pdf`;

    // Subir el archivo al bucket
    const file = storage.file(destination);
    await file.save(pdfBytes, {
      metadata: {
        contentType: "application/pdf", // Especificar que es un archivo PDF
        cacheControl: "public, max-age=31536000",
      },
    });

    console.log(`El PDF ha sido subido a ${destination}`);

    // Obtener URL pública del archivo subido
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });

    // Configurar la respuesta como un archivo PDF
    res.setHeader("Content-Type", "application/json");
    // Enviar el PDF como respuesta
    res.status(200).send({message: url});

    /* res.setHeader("Content-Type", "application/pdf");
    res.status(200).send(pdfBytes); */
  } catch (error) {
    console.error("Error generando el PDF: ", error);
    res.setHeader("Content-Type", "application/json");

    // Utiliza el message del objeto Error
    const errorMessage = error.message || "Ocurrió un error desconocido";

    // Chequea el tipo de error con los mensajes que iniciaste en los throw
    if (errorMessage.startsWith("BAD REQUEST")) {
      res.status(400).json({
        message: `Solicitud incorrecta: ${errorMessage}`,
      });
    } else if (errorMessage.startsWith("UNAUTHORIZED")) {
      res.status(401).json({
        message: `Error de autorización: ${errorMessage}`,
      });
    } else if (errorMessage.startsWith("FORBIDDEN")) {
      res.status(403).json({
        message: `Prohibido: ${errorMessage}`,
      });
    } else if (errorMessage.startsWith("NOT FOUND")) {
      res.status(404).json({
        message: `Recurso no encontrado: ${errorMessage}`,
      });
    } else if (errorMessage.startsWith("CONFLICT")) {
      res.status(409).json({
        message: `Conflicto: ${errorMessage}`,
      });
    } else {
      res.status(500).json({
        message: `Error interno del servidor: ${errorMessage}`,
      });
    }
  }
};

exports.reportePDFContactFailed = onRequest({
  cors: [/aion-crml-asm\.flutterflow\.app$/, /app\.flutterflow\.io\/debug$/],
}, createPdf);

/**
 *
 * @param {PDFPage} currentPage Pagina actual
 * @param {string} font Fuente del footer
 * @param {number} footerSize Tamaño de la fuente del footer
 * @param {number} width Ancho para el footer
 */
/* function drawFooter(currentPage, font, footerSize, width) {
  const footerText = `
    CC. Río Plaza Piso 1 - Oficina 1 - Km 1 Vía a Samborondón
    Samborondón
    Celular Oficina Matriz: 0968265924`;

  const footerLines = footerText.trim().split("\n");
  let footerYPosition = 50;

  footerLines.forEach((line) => {
    const textWidth = font.widthOfTextAtSize(line.trim(), footerSize);
    const xPosition = (width - textWidth) / 2; // Cálculo para centrar el texto
    currentPage.drawText(line.trim(), {
      x: xPosition,
      y: footerYPosition,
      size: footerSize,
      font: font,
      color: rgb(0, 0, 0),
    });
    footerYPosition -= footerSize + 2; // Espaciado entre líneas
  });
} */
/**
 *
 * @param {Timestamp | Date} date Fecha a formatear.
 * @param {boolean} JS True si es fecha JavaScript
 * @return {string} Fecha formateada d/m/y.
 */
function formatDate(date, JS) {
  // Convertir el Timestamp de Firebase a un objeto Date de JavaScript
  let newDate;

  if (JS) {
    newDate = date;
  } else {
    newDate = date.toDate();
  }

  // Extraer el día, mes y año
  // Agregar '0' al día si es necesario
  const day = newDate.getDate().toString().padStart(2, "0");
  // Mes (agregar 1 ya que los meses comienzan en 0)
  const month = (newDate.getMonth() + 1).toString().padStart(2, "0");
  const year = newDate.getFullYear();

  // Formatear la fecha como d/m/y
  return `${day}/${month}/${year}`;
}

/**
 *
 * @param {DocumentData[]} data Datos de leads para generar el PDF
 * @param {string} logoUrl Url del logo de la empresa para el PDF
 * @return {Promise<Uint8Array>} Resultado PDF en formato Uint8Array
 */
async function generatePDF(data, logoUrl) {
  // Crear un nuevo documento PDF tamaño carta
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage(PageSizes.Letter);
  const {width, height} = page.getSize();

  // eslint-disable-next-line max-len
  // Cargar la imagen de la captura de pantalla (la imagen debe estar en una URL accesible públicamente)
  const logoBytes = await fetch(logoUrl).then((res) => res.arrayBuffer());
  const logoImage = await pdfDoc.embedPng(logoBytes);
  const logoDims = logoImage.scale(0.5); // Escalar la imagen si es necesario

  const fontSize = 8;
  const footerFontSize = 8;
  const footerMargin = 10;

  // Dibujar el logo en la página
  page.drawImage(logoImage, {
    x: 35,
    y: height - logoDims.height - 20,
    width: logoDims.width,
    height: logoDims.height,
  });

  // Establecer las fuentes para el texto
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(
      fs.readFileSync("./montserrat 2/Montserrat-Regular.otf"),
  );

  const fontBold = await pdfDoc.embedFont(
      fs.readFileSync("./montserrat 2/Montserrat-Bold.otf"),
  );
  // Título
  // Título: "REPORTE DE LEADS"
  page.drawText("REPORTE DE LEADS NO CONTACTADOS", {
    x: 35,
    y: height - 130,
    size: fontSize,
    font: fontBold,
    color: rgb(0, 0.129, 0.302),
  });

  // Tabla de datos
  const tableTop = height - 160;
  const tableLeft = 35;
  const rowHeight = 20;
  let yPosition = tableTop;

  const headers = [
    {label: "Fecha", key: "fecha"},
    {label: "Descripción", key: "descripcion"},
    {label: "Usuario", key: "nombre_usuario"},
    {label: "Hora de inicio", key: "inicio"},
    {label: "Hora de termino", key: "final"},
    {label: "Horas trabajadas", key: "horasTrabajadas"},
    {label: "Horas facturables", key: "horasFacturables"},
    {label: "Tarifa por hora", key: "tarifaHora"},
    {label: "Valor trabajo", key: "valorTrabajo"},
  ];
  const columnWidths = [66, 115, 98, 41, 66, 66, 82, 82, 82];

  headers.forEach((header, i) => {
    const xPosition = tableLeft + columnWidths
        .slice(0, i)
        .reduce((a, b) => a + b, 0);

    // Dibujar rectángulo de la celda del encabezado
    page.drawRectangle({
      x: xPosition,
      y: yPosition - rowHeight,
      width: columnWidths[i],
      height: rowHeight,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // Dibujar el texto del encabezado
    page.drawText(header.label, {
      x: xPosition + 5, // Padding para el texto
      y: yPosition - fontSize - 2, // Ajuste adicional para evitar superposición
      size: fontSize,
      font: font,
      color: rgb(0, 0, 0),
    });
  });

  // Ajustar yPosition para empezar con las filas de datos
  yPosition -= rowHeight;

  // Dibujar filas de datos y bordes
  data.forEach((row, index) => {
    let maxLines = 1; // Para almacenar la cantidad máxima de líneas en una fila

    // Calcular el máximo de líneas para cualquier columna en la fila actual
    headers.forEach((header, i) => {
      const cellText = row[header.key] || "";
      const lines = splitTextIntoLines(
          cellText.toString(),
          columnWidths[i] - 10,
          fontSize,
          font,
      );
      maxLines = Math.max(maxLines, lines.length);
    });

    const spaceForFooter = footerMargin + 85 + footerFontSize * 4;
    // eslint-disable-next-line max-len
    if (index === data.length - 1 && yPosition - maxLines * rowHeight < spaceForFooter) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yPosition = height - 50; // Reiniciar yPosition para la nueva página
    } else if (yPosition - maxLines * rowHeight < 60 + footerMargin) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yPosition = height - 50; // Reiniciar yPosition para la nueva página
    }

    headers.forEach((header, i) => {
      const xPosition = tableLeft + columnWidths
          .slice(0, i)
          .reduce((a, b) => a + b, 0);
      const cellHeight = maxLines * rowHeight;

      // Dibujar el rectángulo de la celda
      page.drawRectangle({
        x: xPosition,
        y: yPosition - cellHeight,
        width: columnWidths[i],
        height: cellHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });

      // Obtener el valor de la celda correspondiente usando la clave correcta
      const cellText = row[header.key] || "";
      const lines = splitTextIntoLines(
          cellText.toString(),
          columnWidths[i] - 10,
          fontSize,
          font,
      );

      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: xPosition + 5,
          y: yPosition - (lineIndex * rowHeight) - 15,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0),
        });
      });
    });

    // Ajustar yPosition para la siguiente fila
    yPosition -= (maxLines * rowHeight);
  });

  pdfDoc.getPages().forEach((p, index) => {
    if (index === pdfDoc.getPageCount() - 1) {
      drawFooter(p, font, footerFontSize, width);
    }
  });

  return await pdfDoc.save();
}

/**
 *
 * @param {string} text Texto a dividir
 * @param {number} maxWidth Ancho maximo que debe tener cada linea
 * @param {number} fontSize Tamaño de la fuente
 * @param {PDFFont} font Fuente del texto
 * @return {string} Divide el texto en varias líneas si es necesario
 */
function splitTextIntoLines(text, maxWidth, fontSize, font) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const testLine = currentLine ? currentLine + " " + word : word;
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 *
 * @param {PDFPage} currentPage Pagina actual
 * @param {string} font Fuente del footer
 * @param {number} footerSize Tamaño de la fuente del footer
 * @param {number} width Ancho para el footer
 */
function drawFooter(currentPage, font, footerSize, width) {
  // eslint-disable-next-line max-len
  const footerText = `CC. Río Plaza Piso 1 - Oficina 1 - Km 1 Vía a Samborondón\nSamborondón\nCelular Oficina Matriz: 0968265924`;

  const footerLines = footerText.trim().split("\n");
  let footerYPosition = 50;

  footerLines.forEach((line) => {
    const textWidth = font.widthOfTextAtSize(line.trim(), footerSize);
    const xPosition = (width - textWidth) / 2; // Cálculo para centrar el texto
    currentPage.drawText(line.trim(), {
      x: xPosition,
      y: footerYPosition,
      size: footerSize,
      font: font,
      color: rgb(0, 0, 0),
    });
    footerYPosition -= footerSize + 2; // Espaciado entre líneas
  });
}

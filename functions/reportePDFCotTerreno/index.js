require("dotenv").config({path: "./.env"});
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const {
  getFirestore,
  FieldValue,
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
const {DateTime} = require("luxon");

if (process.env.NODE_ENV === "production") {
  admin.initializeApp();
} else {
  const serviceAccount = require("./serviceAccountKey.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
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
  console.log(`Estamos en entorno: ${process.env.NODE_ENV}`);
  const db = getFirestore();
  try {
    const {clienteId, landsQuoteId, planoUrl, logoUrl} = req.body;

    if (!clienteId || !landsQuoteId || !planoUrl || !logoUrl) {
      // eslint-disable-next-line max-len
      throw new Error("BAD REQUEST: No se proporcionaron alguno de los siguientes parámetros: clienteId, landsQuoteId, planoUrl y/o logoUrl");
    }
    const clientRef = db.collection("contactos").doc(clienteId);
    const clientData = (await clientRef
        .get())
        .data();

    const cotizacionData = (await db
        .collection("landsQuote")
        .doc(landsQuoteId)
        .get()).data();

    const resultados = {
      cliente: `${clientData.title || ""} ${clientData.name}`,
      email: `${clientData.email || ""}`,
      cedula: `${clientData.idNumber || ""}`,
      solar: `${cotizacionData.solar || ""}`,
      area: `${cotizacionData.landAreaM2?
        cotizacionData.landAreaM2.toFixed(2) + "M2" : "" }`,
      precio: `${cotizacionData.price?
        "$" + cotizacionData.price.toFixed(2) : ""}`,
      reserva: `${cotizacionData.booking?
        "$" + cotizacionData.booking.toFixed(2) : ""}`,
      entrada: {
        value1: `${cotizacionData.entrancePercentage?
          Math.round(cotizacionData.entrancePercentage) + "%" : ""}`,
        value2: `${cotizacionData.entranceBooking?
          "$" + cotizacionData.entranceBooking.toFixed(2) : ""}`,
      },
      cuotasMens: {
        value1: `${cotizacionData.monthQuotasAmount || ""}`,
        value2: `${cotizacionData.monthQuotasValue?
          "$" + cotizacionData.monthQuotasValue.toFixed(2) : ""}`,
      },
      firstExpiration: `${cotizacionData.firstExpiration?
        formatDate(cotizacionData.firstExpiration, false) : ""}`,
      saldo: {
        value1: `${cotizacionData.bankCreditBalancePercentage?
          Math.round(cotizacionData.bankCreditBalancePercentage) + "%" : ""}`,
        value2: `${cotizacionData.bankCreditBalanceValue?
          "$" + cotizacionData.bankCreditBalanceValue.toFixed(2) : ""}`,
      },
      cuotasTotales: [],
    };

    // Obtenemos la fecha de la primera expiración utilizando luxon
    const firstExpirationDate = DateTime
        .fromJSDate(cotizacionData.firstExpiration.toDate());

    // Recorremos la cantidad de cuotas mensuales
    for (let i = 0; i < parseInt(cotizacionData.monthQuotasAmount); i++) {
      // Calculamos la fecha de cada cuota sumando meses a la `firstExpiration`
      const fechaCuota = firstExpirationDate
          .plus({months: i}).toFormat("dd/MM/yyyy");

      // Añadimos la cuota al array `cuotasTotales`
      resultados.cuotasTotales.push({
        numCuota: i + 1, // Incrementamos el número de la cuota
        valor: "$" + cotizacionData.monthQuotasValue.toFixed(2),
        fecha: fechaCuota, // Fecha de la cuota
      });
    }

    // Llamar a la función que genera el PDF
    const pdfBytes = Buffer
        .from(await generatePDF(
            resultados,
            logoUrl,
            planoUrl,
        ));

    const storage = getStorage().bucket("aion-crm-asm.appspot.com");

    // eslint-disable-next-line max-len
    const destination = `pdfs/cotizaciones/${clientData.name}-${new Date(Date.now())}.pdf`;

    // Subir el archivo al bucket
    const file = storage.file(destination);
    await file.save(pdfBytes, {
      metadata: {
        contentType: "application/pdf", // Especificar que es un archivo PDF
        cacheControl: "public, max-age=31536000",
      },
    });

    console.log(`El PDF ha sido subido a ${destination}`);

    (await db
        .collection("landsQuote")
        .doc(landsQuoteId)
        .update({
          registrationDate: FieldValue.serverTimestamp(),
          landQuoteUrl: file.baseUrl,
        }));

    // Obtener URL pública del archivo subido
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000,
    });

    /* // Configurar la respuesta como un archivo PDF
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
        "Content-Disposition",
        "attachment; filename=cotizacion_terreno.pdf",
    );

    res.status(200).send(pdfBytes); */

    // Configurar la respuesta como un archivo PDF
    res.setHeader("Content-Type", "application/json");
    res.status(200).send({message: url});
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

exports.reportePDFCotTerreno = onRequest((req, res) => {
  const allowedOrigins = [
    "https://aion-crm.flutterflow.app",
    "https://app.flutterflow.io/debug",
  ];

  const origin = req.headers.origin;

  // Verifica si el origen de la solicitud está en la lista de orígenes
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Manejo de solicitud preflight (OPTIONS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Aquí puedes seguir con tu lógica principal (createPdf)
  createPdf(req, res);
});

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
 * @param {object} resultados Datos para la generación del PDF
 * @param {string} logoUrl Logo de la empresa que genera el pdf
 * @param {string} planoUrl Imágen del plano de la cotización
 * @return {Promise<Uint8Array>} Uint8Array con el pdf generado
 */
async function generatePDF(resultados, logoUrl, planoUrl) {
  // Crear un nuevo documento PDF tamaño carta
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage(PageSizes.Letter);
  const {width, height} = page.getSize();

  // eslint-disable-next-line max-len
  // Cargar la imagen de la captura de pantalla (la imagen debe estar en una URL accesible públicamente)
  const logoBytes = await fetch(logoUrl).then((res) => res.arrayBuffer());
  const logoImage = await pdfDoc.embedPng(logoBytes);
  const logoDims = logoImage.scale(0.5); // Escalar la imagen si es necesario

  const image1Bytes = await fetch(planoUrl).then((res) => res.arrayBuffer());
  const image1Image = await pdfDoc.embedJpg(image1Bytes);
  const image1Dims = image1Image.scale(0.2);

  const marginTop = 50;
  const marginBottom = 50; // Margen inferior para el contenido antes del footer
  const footerHeight = 60; // Altura reservada para el footer
  const fontSize = 8;
  const footerFontSize = 8;

  // Dibujar el logo en la página
  page.drawImage(logoImage, {
    x: width / 3,
    y: logoDims.height > 90?
      height - logoDims.height : height - logoDims.height - 20,
    width: logoDims.width * 2,
    height: logoDims.height > 90? logoDims.height : logoDims.height * 1.2,
  });

  // Dibujar la imagen 1 en la página
  page.drawImage(image1Image, {
    x: width / 1.85,
    y: height - image1Dims.height - 200,
    width: image1Dims.width * 1.2,
    height: image1Dims.height * 1.8,
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
  page.drawText("COTIZACION DE TERRENO", {
    x: 75,
    y: height - 80,
    size: fontSize + 2,
    font: fontBold,
    color: rgb(0.004, 0, 0.329),
  });
  let xFields = 20;
  let yFields = height - 110;

  // Campos de texto
  const fields = [
    {label: "Cliente:", key: "cliente"},
    {label: "Correo:", key: "email"},
    {label: "Cédula:", key: "cedula"},
    {label: "Solar:", key: "solar"},
    {label: "Área de Terreno (M2):", key: "area"},
    {label: "Precio:", key: "precio"},
    {label: "Reserva:", key: "reserva"},
    {label: "ENTRADA - RESERVA:", key: "entrada"},
    {label: "Cuotas mensuales:", key: "cuotasMens"},
    {label: "Primer Vencimiento:", key: "firstExpiration"},
    {label: "Saldo CRÉDITO BANCARIO:", key: "saldo"},
  ];

  const rowHeight = 20;

  // Dibujar los campos de texto
  fields.forEach((field) => {
    page.drawText(field.label, {
      x: xFields,
      y: yFields,
      size: field.label == "Saldo CRÉDITO BANCARIO:" ?
        fontSize - 1 :
        fontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    if (resultados[field.key].value2) {
      page.drawRectangle({
        x: xFields + 100,
        y: yFields - 5,
        width: 50,
        height: rowHeight,
        borderColor: rgb(0.635, 0.635, 0.635),
        borderWidth: 1,
      });

      page.drawRectangle({
        x: xFields + 160,
        y: yFields - 5,
        width: 140,
        height: rowHeight,
        borderColor: rgb(0.635, 0.635, 0.635),
        borderWidth: 1,
      });

      page.drawText(resultados[field.key].value1, {
        x: xFields + 110,
        y: yFields,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });

      page.drawText(resultados[field.key].value2, {
        x: xFields + 170,
        y: yFields,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });

      yFields -= 30;

      return;
    }

    page.drawRectangle({
      x: xFields + 100,
      y: yFields - 5,
      width: 200,
      height: rowHeight,
      borderColor: rgb(0.635, 0.635, 0.635),
      borderWidth: 1,
    });

    page.drawText(resultados[field.key], {
      x: xFields + 110,
      y: yFields,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    yFields -= 30;
  });

  page.drawRectangle({
    x: xFields + 90,
    y: yFields - 5,
    width: 40,
    height: rowHeight,
    borderColor: rgb(0.635, 0.635, 0.635),
    borderWidth: 1,
  });

  page.drawRectangle({
    x: xFields + 130,
    y: yFields - 5,
    width: 90,
    height: rowHeight,
    borderColor: rgb(0.635, 0.635, 0.635),
    borderWidth: 1,
  });

  page.drawRectangle({
    x: xFields + 220,
    y: yFields - 5,
    width: 80,
    height: rowHeight,
    borderColor: rgb(0.635, 0.635, 0.635),
    borderWidth: 1,
  });

  page.drawText("Cuota", {
    x: xFields + 95,
    y: yFields,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });

  page.drawText("Fecha", {
    x: xFields + 135,
    y: yFields,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });

  page.drawText("Valor", {
    x: xFields + 225,
    y: yFields,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });

  yFields -= 20;

  resultados.cuotasTotales.forEach((cuota) => {
    if (yFields - rowHeight < footerHeight + marginBottom) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yFields = height - marginTop; // Reiniciar la posición Y
    }

    page.drawRectangle({
      x: xFields + 90,
      y: yFields - 5,
      width: 40,
      height: rowHeight,
      borderColor: rgb(0.635, 0.635, 0.635),
      borderWidth: 1,
    });

    page.drawRectangle({
      x: xFields + 130,
      y: yFields - 5,
      width: 90,
      height: rowHeight,
      borderColor: rgb(0.635, 0.635, 0.635),
      borderWidth: 1,
    });

    page.drawRectangle({
      x: xFields + 220,
      y: yFields - 5,
      width: 80,
      height: rowHeight,
      borderColor: rgb(0.635, 0.635, 0.635),
      borderWidth: 1,
    });

    page.drawText(`${cuota.numCuota}`, {
      x: xFields + 95,
      y: yFields,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText(cuota.fecha, {
      x: xFields + 135,
      y: yFields,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText(cuota.valor, {
      x: xFields + 225,
      y: yFields,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    yFields -= 20;
  });

  yFields -= 100;

  if (yFields - rowHeight < footerHeight + marginBottom) {
    page = pdfDoc.addPage(PageSizes.Letter);
    yFields = height - marginTop - 100; // Reiniciar la posición Y
  }

  page.drawRectangle({
    x: xFields,
    y: yFields,
    width: 140,
    height: 100,
    borderWidth: 2,
    borderColor: rgb(0.635, 0.635, 0.635),
    color: rgb(1, 1, 1),
    opacity: 0.5,
    borderOpacity: 0.75,
  });

  page.drawText("Firma Autorizada:", {
    x: xFields + 35,
    y: yFields + 90,
    font: fontBold,
    size: fontSize,
    color: rgb(0, 0, 0),
  });

  page.drawLine({
    start: {x: xFields + 25, y: yFields + 30},
    end: {x: xFields + 120, y: yFields + 30},
    thickness: 2,
    color: rgb(0.004, 0, 0.329),
    opacity: 0.75,
  });

  page.drawText("URB VISTALMAR", {
    x: xFields + 40,
    y: yFields + 20,
    font,
    size: fontSize,
    color: rgb(0, 0, 0),
  });

  xFields = xFields + 160;

  page.drawRectangle({
    x: xFields,
    y: yFields,
    width: 140,
    height: 100,
    borderWidth: 2,
    borderColor: rgb(0.635, 0.635, 0.635),
    color: rgb(1, 1, 1),
    opacity: 0.5,
    borderOpacity: 0.75,
  });

  page.drawText("Cliente:", {
    x: xFields + 55,
    y: yFields + 90,
    font: fontBold,
    size: fontSize,
    color: rgb(0, 0, 0),
  });

  page.drawLine({
    start: {x: xFields + 25, y: yFields + 30},
    end: {x: xFields + 120, y: yFields + 30},
    thickness: 2,
    color: rgb(0.004, 0, 0.329),
    opacity: 0.75,
  });

  page.drawText(resultados[fields[0].key], {
    x: xFields + 30,
    y: yFields + 20,
    font,
    size: fontSize,
    color: rgb(0, 0, 0),
  });

  yFields -= 10;

  xFields = 20;

  if (yFields - rowHeight < footerHeight + marginBottom) {
    page = pdfDoc.addPage(PageSizes.Letter);
    yFields = height - marginTop; // Reiniciar la posición Y
  }

  page.drawText("IMPORTANTE:", {
    x: xFields,
    y: yFields - 30,
    font: fontBold,
    size: fontSize + 2,
    color: rgb(0, 0, 0),
  });

  page.drawLine({
    start: {x: xFields, y: yFields - 31},
    end: {x: xFields + 70, y: yFields - 31},
    thickness: 1,
    color: rgb(0, 0, 0),
  });

  yFields -= 50;

  if (yFields - rowHeight < footerHeight + marginBottom) {
    page = pdfDoc.addPage(PageSizes.Letter);
    yFields = height - marginTop; // Reiniciar la posición Y
  }

  // eslint-disable-next-line max-len
  page.drawText("* Acercarse a firmar su contrato en un plazo máximo de 7 días, contados desde", {
    x: xFields,
    y: yFields,
    font,
    size: fontSize + 2,
    color: rgb(0, 0, 0),
  });

  if (yFields - rowHeight < footerHeight + marginBottom) {
    page = pdfDoc.addPage(PageSizes.Letter);
    yFields = height - marginTop; // Reiniciar la posición Y
  }

  page.drawText("la presente fecha.", {
    x: xFields,
    y: yFields - 10,
    font,
    size: fontSize + 2,
    color: rgb(0, 0, 0),
  });

  if (yFields - rowHeight < footerHeight + marginBottom) {
    page = pdfDoc.addPage(PageSizes.Letter);
    yFields = height - marginTop; // Reiniciar la posición Y
  }

  // eslint-disable-next-line max-len
  page.drawText("* El o los abajo firmantes, autorizamos a solicitar y obtener mi información crediticia", {
    x: xFields,
    y: yFields - 30,
    font,
    size: fontSize + 2,
    color: rgb(0, 0, 0),
  });

  if (yFields - rowHeight < footerHeight + marginBottom) {
    page = pdfDoc.addPage(PageSizes.Letter);
    yFields = height - marginTop; // Reiniciar la posición Y
  }

  page.drawText("en Buró de Créditos y Central de Riesgo.", {
    x: xFields,
    y: yFields - 40,
    font,
    size: fontSize + 2,
    color: rgb(0, 0, 0),
  });

  pdfDoc.getPages().forEach((p, _) => {
    // eslint-disable-next-line max-len
    drawFooter(p, fontBold, footerFontSize, width); // Dibujar solo el pie de página común
  });
  // Guardar el PDF en memoria
  return await pdfDoc.save();
}

require("dotenv").config({path: "./.env"});
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const {
  getFirestore,
  // eslint-disable-next-line no-unused-vars
  Timestamp,
  FieldValue,
} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const {
  PDFDocument,
  rgb,
  StandardFonts,
  PageSizes,
  // eslint-disable-next-line no-unused-vars
  PDFPage,
} = require("pdf-lib");

admin.initializeApp();
setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});

/**
 * Función para crear pdf para cotización del terreno.
 * @param {Request} req Datos de la solicitud HTTP
 * @param {Response} res Respuesta de la solicitud HTTP
 */
const createPdf = async (req, res) => {
  const db = getFirestore();
  try {
    const clientRef = db.collection("contactos").doc(req.body.clienteId);
    const clientData = (await clientRef
        .get())
        .data();

    const cotizacionData = (await db
        .collection("landsQuote")
        .where("clienteId", "==", clientRef)
        .get()).docs.map((landquote) => {
      return landquote.data();
    });

    console.log(cotizacionData[0]);

    let firstExpiration;
    const nowDate = formatDate(new Date(Date.now()), true);

    if (cotizacionData[0].firstExpiration) {
      firstExpiration = formatDate(cotizacionData[0].firstExpiration, false);
    }

    // Crear un nuevo documento PDF tamaño carta
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage(PageSizes.Letter);
    const {width, height} = page.getSize();

    // eslint-disable-next-line max-len
    // Cargar la imagen de la captura de pantalla (la imagen debe estar en una URL accesible públicamente)
    const logoUrl = "https://vistalmar.com.ec/wp-content/uploads/2018/10/logo-web-adapt.png"; // Reemplazar con una URL accesible
    const logoBytes = await fetch(logoUrl).then((res) => res.arrayBuffer());
    const logoImage = await pdfDoc.embedPng(logoBytes);
    const logoDims = logoImage.scale(0.5); // Escalar la imagen si es necesario

    const image1Url = "https://vistalmar.com.ec/wp-content/uploads/2018/12/RENDER-lotes.jpg";
    const image1Bytes = await fetch(image1Url).then((res) => res.arrayBuffer());
    const image1Image = await pdfDoc.embedJpg(image1Bytes);
    const image1Dims = image1Image.scale(0.2);

    const fontSize = 8;
    const footerFontSize = 8;

    // Dibujar el logo en la página
    page.drawImage(logoImage, {
      x: width / 3,
      y: height - logoDims.height - 20,
      width: logoDims.width * 2,
      height: logoDims.height * 1.2,
    });

    // Dibujar la imagen 1 en la página
    page.drawImage(image1Image, {
      x: width / 1.85,
      y: height - image1Dims.height - 200,
      width: image1Dims.width * 1.2,
      height: image1Dims.height * 1.8,
    });

    // Establecer las fuentes para el texto
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

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
      {
        label: "Cliente:",
        value: `${clientData.title || ""} ${clientData.name || ""}`,
        x: xFields,
        y: yFields,
      }, {
        label: "Correo:",
        value: clientData.email || "",
        x: xFields,
        y: yFields,
      }, {
        label: "Cédula:",
        value: clientData.idNumber || "",
        x: xFields,
        y: yFields,
      }, {
        label: "Solar:",
        value: `${cotizacionData[0].solar}` || "",
        x: xFields,
        y: yFields,
      }, {
        label: "Área de Terreno (M2):",
        value: `${cotizacionData[0].landAreaM2} m2` || "",
        x: xFields,
        y: yFields,
      }, {
        label: "Precio:",
        value: `${cotizacionData[0].price?
          cotizacionData[0].price.toFixed(2) :
          ""}`,
        x: xFields,
        y: yFields,
      }, {
        label: "Reserva:",
        value: `${cotizacionData[0].booking?
          cotizacionData[0].booking.toFixed(2) :
          ""}`,
        x: xFields,
        y: yFields,
      }, {
        label: "ENTRADA - RESERVA:",
        value: `${cotizacionData[0].entrancePercentage}%` || "",
        x: xFields,
        y: yFields,
        value2: `${cotizacionData[0].entranceBooking?
          cotizacionData[0].entranceBooking.toFixed(2) :
          ""}`,
      }, {
        label: "Cuotas mensuales:",
        value: `${cotizacionData[0].monthQuotasAmount}` || "",
        x: xFields,
        y: yFields,
        value2: `${cotizacionData[0].monthQuotasValue?
          cotizacionData[0].monthQuotasValue.toFixed(2) :
          ""}`,
      }, {
        label: "Primer Vencimiento:",
        value: firstExpiration || "",
        x: xFields,
        y: yFields,
      }, {
        label: "Saldo CRÉDITO BANCARIO:",
        value: `${cotizacionData[0].bankCreditBalancePercentage}%`,
        x: xFields,
        y: yFields,
        value2: `${cotizacionData[0].bankCreditBalanceValue?
          cotizacionData[0].bankCreditBalanceValue.toFixed(2) :
          ""}`,
      }, {
        label: "Cuotas:",
        value: `${cotizacionData[0].quotas}` || "",
        x: xFields,
        y: yFields,
      }, {
        label: "Fecha:",
        value: nowDate,
        x: xFields,
        y: yFields,
      },
    ];

    const rowHeight = 20;

    // Dibujar los campos de texto
    fields.forEach((field) => {
      page.drawText(field.label, {
        x: field.x,
        y: yFields,
        size: fontSize,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      if (field.value2) {
        page.drawRectangle({
          x: field.x + 100,
          y: yFields - 5,
          width: 50,
          height: rowHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });

        page.drawRectangle({
          x: field.x + 160,
          y: yFields - 5,
          width: 140,
          height: rowHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });

        page.drawText(field.value, {
          x: field.x + 110,
          y: yFields,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });

        page.drawText(field.value2, {
          x: field.x + 170,
          y: yFields,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });

        yFields = yFields - 30;

        return;
      }

      page.drawRectangle({
        x: field.x + 100,
        y: yFields - 5,
        width: 200,
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });

      page.drawText(field.value, {
        x: field.x + 110,
        y: yFields,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });

      yFields = yFields - 30;
    });

    page.drawRectangle({
      x: xFields,
      y: yFields - 90,
      width: 140,
      height: 100,
      borderWidth: 1,
      borderColor: rgb(0.004, 0, 0.329),
      color: rgb(1, 1, 1),
      opacity: 0.5,
      borderOpacity: 0.75,
    });

    page.drawText("Firma Autorizada:", {
      x: xFields + 35,
      y: yFields,
      font: fontBold,
      size: fontSize,
      color: rgb(0, 0, 0),
    });

    page.drawLine({
      start: {x: xFields + 25, y: yFields - 60},
      end: {x: xFields + 120, y: yFields - 60},
      thickness: 2,
      color: rgb(0.004, 0, 0.329),
      opacity: 0.75,
    });

    page.drawText("URB VISTALMAR", {
      x: xFields + 40,
      y: yFields - 75,
      font,
      size: fontSize,
      color: rgb(0, 0, 0),
    });

    xFields = xFields + 160;

    page.drawRectangle({
      x: xFields,
      y: yFields - 90,
      width: 140,
      height: 100,
      borderWidth: 1,
      borderColor: rgb(0.004, 0, 0.329),
      color: rgb(1, 1, 1),
      opacity: 0.5,
      borderOpacity: 0.75,
    });

    page.drawText("Cliente:", {
      x: xFields + 55,
      y: yFields,
      font: fontBold,
      size: fontSize,
      color: rgb(0, 0, 0),
    });

    page.drawLine({
      start: {x: xFields + 25, y: yFields - 60},
      end: {x: xFields + 120, y: yFields - 60},
      thickness: 2,
      color: rgb(0.004, 0, 0.329),
      opacity: 0.75,
    });

    page.drawText(fields[0].value, {
      x: xFields + 40,
      y: yFields - 75,
      font,
      size: fontSize,
      color: rgb(0, 0, 0),
    });

    yFields -= 75;

    xFields = 20;

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

    // eslint-disable-next-line max-len
    page.drawText("* Acercarse a firmar su contrato en un plazo máximo de 7 días, contados desde", {
      x: xFields,
      y: yFields - 50,
      font,
      size: fontSize + 2,
      color: rgb(0, 0, 0),
    });

    page.drawText("la presente fecha.", {
      x: xFields,
      y: yFields - 60,
      font,
      size: fontSize + 2,
      color: rgb(0, 0, 0),
    });

    // eslint-disable-next-line max-len
    page.drawText("* El o los abajo firmantes, autorizamos a solicitar y obtener mi información crediticia", {
      x: xFields,
      y: yFields - 80,
      font,
      size: fontSize + 2,
      color: rgb(0, 0, 0),
    });

    page.drawText("en Buró de Créditos y Central de Riesgo.", {
      x: xFields,
      y: yFields - 90,
      font,
      size: fontSize + 2,
      color: rgb(0, 0, 0),
    });

    pdfDoc.getPages().forEach((p, _) => {
      // eslint-disable-next-line max-len
      drawFooter(p, fontBold, footerFontSize, width); // Dibujar solo el pie de página común
    });
    // Guardar el PDF en memoria
    const pdfBytes = await pdfDoc.save();

    const storage = getStorage().bucket("aion-crm-asm.appspot.com");

    const destination = `pdfs/${clientData.name}-${new Date(Date.now())}.pdf`;

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
        .doc(cotizacionData[0].id)
        .update({
          registrationDate: FieldValue.serverTimestamp(),
          landQuoteUrl: file.baseUrl,
        }));

    // Obtener URL pública del archivo subido
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: "03-09-2025",
    });

    // Configurar la respuesta como un archivo PDF
    res.setHeader("Content-Type", "application/pdf");
    // eslint-disable-next-line max-len
    res.setHeader("Content-Disposition", "attachment; filename=cotizacion_terreno.pdf");

    // Enviar el PDF como respuesta
    res.status(200).send({message: url});
  } catch (error) {
    console.error("Error generando el PDF: ", error);
    res.status(500).send("Error generando el PDF: ", error);
  }
};

exports.reportePDFCotTerreno = onRequest({
  cors: [/aion-crml-asm\.flutterflow\.app$/, /app\.flutterflow\.io\/debug$/],
}, createPdf);

/**
 *
 * @param {PDFPage} currentPage Pagina actual
 * @param {string} font Fuente del footer
 * @param {number} footerSize Tamaño de la fuente del footer
 * @param {number} width Ancho para el footer
 */
function drawFooter(currentPage, font, footerSize, width) {
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

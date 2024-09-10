require("dotenv").config({path: "./.env"});
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");
const axios = require("axios");

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
const contificoDocuments = async (req, res) => {
  console.log(`Estamos en entorno: ${process.env.NODE_ENV}`);
  const db = getFirestore();
  const batch = db.batch();
  try {
    const {fecha} = req.body;

    if (!fecha) {
      // eslint-disable-next-line max-len
      throw new Error("BAD REQUEST: No se proporcionaron alguno de los siguientes parámetros: fecha");
    }

    const date = new Date(fecha);

    let docs = [];

    await axios({
      method: "GET",
      url: process.env.CONTIFICO_URI_DOCUMENT +
      "?tipo_registro=CLI&fecha_emision=" +
      date.toLocaleDateString("en-GB"),
      headers: {"Authorization": process.env.CONTIFICO_AUTH_TOKEN},
    }).then((res) => {
      docs = res.data;
    }).catch((err) => console.error(err));

    for (const doc of docs) {
      const data = {
        idDocumento: doc.id,
        fechaCreacion: Timestamp.
            fromDate(convertToDate(doc.fecha_creacion)) || null,
        fechaEmision: Timestamp.
            fromDate(convertToDate(doc.fecha_emision)) || null,
        estado: doc.estado,
        urlRide: doc.url_ride,
        total: parseFloat(doc.total),
        tipoDocumento: doc.tipo_documento,
        documento: doc.documento,
        descripcion: doc.descripcion,
      };
      const exist = (await db
          .collection("documentos")
          .where("idDocumento", "==", doc.id)
          .get())
          .docs.map((document) => ({
            ref: document.ref,
          }));
      if (exist.length > 0) {
        batch.update(exist[0].ref, data);
      } else {
        const newDocRef = db.collection("documentos").doc();
        batch.create(newDocRef, data);
      }
    }

    await batch.commit();

    res.setHeader("Content-Type", "application/json");
    res
        .status(200)
        .send({
          message:
            `${docs.length} documentos guardados o actualizados correctamente`,
        });

    /* res.setHeader("Content-Type", "application/json");
    res.status(200).send({message: url}); */
  } catch (error) {
    console.error("Error guardando los documentos: ", error);
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

exports.obtenerDocsContifico = onRequest((req, res) => {
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
  contificoDocuments(req, res);
});

/**
 * @param {string} dateString Fecha a formatear
 * @return {Date} Fecha formateada correctamente
 */
function convertToDate(dateString) {
  // Verifica si el formato es DD/MM/YYYY
  const [day, month, year] = dateString.split("/");
  return new Date(`${year}-${month}-${day}`);
}

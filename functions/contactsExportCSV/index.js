/* eslint-disable max-len */
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
// eslint-disable-next-line no-unused-vars
const {getFirestore, QuerySnapshot} = require("firebase-admin/firestore");

admin.initializeApp();
setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});

const contactsExportCSV = async (req, res) => {
  try {
    const db = getFirestore();
    // Consulta a Firestore
    const contactosSnapshot = await db.collection("contactos").get();

    if (contactosSnapshot.empty) {
      throw new Error("NOT FOUND: No se encontraron contactos");
    }

    // Extraer los campos 'id' y 'phone'
    const contactosData = [];
    contactosSnapshot.forEach((doc) => {
      const data = doc.data();
      contactosData.push({id: doc.id, phone: data.phone});
    });

    // Crear CSV
    const csvContent = arrayToCSV(contactosData);

    // Configurar cabeceras para retornar el CSV como archivo descargable
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="contactos.csv"`);

    // Enviar el contenido del CSV
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error("Error generando el CSV: ", error);
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

/**
 * Función que transforma un array en CSV
 * @param {QuerySnapshot[]} data Registros de CSV
 * @return {string} Retorna el formato para archivos CSV
 */
function arrayToCSV(data) {
  const headers = ["id", "phone"];
  const rows = data.map((item) => [item.id, item.phone].join(","));
  return [headers.join(","), ...rows].join("\n");
}

exports.contactsExportCSV = onRequest((req, res) => {
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
  contactsExportCSV(req, res);
});

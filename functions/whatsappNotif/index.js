/* eslint-disable max-len */
require("dotenv").config({path: "./.env"});
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
// eslint-disable-next-line no-unused-vars
const {Timestamp, QueryDocumentSnapshot, DocumentData} = require("firebase-admin/firestore");
const {getFirestore} = require("firebase-admin/firestore");
const WhatsApp = require("whatsapp");
const {DateTime} = require("luxon");
const {onSchedule} = require("firebase-functions/v2/scheduler");

admin.initializeApp();
setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});

/**
 *
 * @param {Timestamp} now Fecha actual
 * @param {number} days Número de días a calcular
 * @return {Timestamp} Tiempo en milisegundos ya calculado
 */
function calculateTimestamps(now, days) {
  return Timestamp.fromMillis(now.toMillis() + days * 24 * 60 * 60 * 1000);
}
/**
 *
 * @param {QueryDocumentSnapshot} payments El snapshot de los documentos de la consulta a Firestore
 * @param {string} tipoPago Tipo de pago: "alicuota" o "cuota"
 * @return {object} Estructura de pago
 */
async function processPayments(payments, tipoPago) {
  const result = {
    monto: 0,
    cantidad: 0,
    fechas: [],
    idsPago: [],
  };

  payments.forEach((paymentDoc) => {
    const paymentData = paymentDoc.data();
    if (paymentData.paymentType == tipoPago) {
      result.monto += paymentData.balance;
      result.cantidad += 1;
      result.fechas.push(paymentData.planDate.toDate());
      result.idsPago.push(paymentDoc.id);
    }
  });

  return result;
}

/**
 *
 * @param {DocumentData} contacto Persona a la que se le enviará la notificación de WhatsApp
 * @param {object} alicuotas Objeto que contiene los datos de las alicuotas
 * @param {object} cuotas Objeto que contiene los datos de las cuotas
 * @param {string} tipo Indica si es "futuro" o "vencido"
 * @return {object} Retorna un objeto con el template para ser enviado por la notificación de WhatsApp
 */
function createTemplateData(contacto, alicuotas, cuotas, tipo) {
  let templateData = {};
  if (alicuotas.cantidad >= 1 && cuotas.cantidad >= 1 && tipo == "vencido") {
    templateData = {
      name: "pagos_pendientes_total",
      language: {policy: "deterministic", code: "es"},
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: contacto.name,
            },
            {
              type: "text",
              text: "AION CRM",
            },
            {
              type: "text",
              text: cuotas.cantidad,
            },
            {
              type: "currency",
              currency: {
                fallback_value: `$${cuotas.monto}`,
                code: "USD",
                amount_1000: cuotas.monto * 1000,
              },
            },
            {
              type: "text",
              text: alicuotas.cantidad,
            },
            {
              type: "currency",
              currency: {
                fallback_value: `USD${alicuotas.monto}`,
                code: "USD",
                amount_1000: alicuotas.monto * 1000,
              },
            },
            {
              type: "currency",
              currency: {
                fallback_value: `USD${alicuotas.monto + cuotas.monto}`,
                code: "USD",
                amount_1000: (alicuotas.monto + cuotas.monto) * 1000,
              },
            },
          ],
        },
      ],
    };
  } else if ((alicuotas.cantidad >= 2 || cuotas.cantidad >= 2) && tipo == "vencido") {
    templateData = {
      name: "pagos_pendientes",
      language: {policy: "deterministic", code: "es"},
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: contacto.name,
            },
            {
              type: "text",
              text: "AION CRM",
            },
            {
              type: "text",
              text: alicuotas.cantidad > 0 ? alicuotas.cantidad : cuotas.cantidad,
            },
            {
              type: "text",
              text: alicuotas.cantidad > 0 ? "alicuotas" : "cuotas",
            },
            {
              type: "currency",
              currency: {
                fallback_value: `$${alicuotas.cantidad > 0 ? alicuotas.monto : cuotas.monto}`,
                code: "USD",
                amount_1000: alicuotas.cantidad > 0 ? alicuotas.monto * 1000 : cuotas.monto * 1000,
              },
            },
          ],
        },
      ],
    };
  } else if ((alicuotas.cantidad == 1 || cuotas.cantidad == 1) && tipo == "vencido") {
    const fecha = alicuotas.cantidad > 0 ?
      DateTime.fromJSDate(alicuotas.fechas[0]) :
      DateTime.fromJSDate(cuotas.fechas[0]);
    templateData = {
      name: "pago_por_pagar",
      language: {policy: "deterministic", code: "es"},
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: contacto.name,
            },
            {
              type: "text",
              text: "AION CRM",
            },
            {
              type: "text",
              text: alicuotas.cantidad > 0 ? "alicuotas" : "cuotas",
            },
            {
              type: "date_time",
              date_time: {
                fallback_value: `${fecha.setLocale("es-EC").toLocaleString(DateTime.DATE_FULL)}`,
                day_of_week: fecha.weekday,
                day_of_month: fecha.day,
                year: fecha.year,
                month: fecha.month,
                hour: fecha.hour,
                minute: fecha.minute,
              },
            },
            {
              type: "currency",
              currency: {
                fallback_value: `$${alicuotas.cantidad > 0 ? alicuotas.monto : cuotas.monto}`,
                code: "USD",
                amount_1000: alicuotas.cantidad > 0 ? alicuotas.monto * 1000 : cuotas.monto * 1000,
              },
            },
          ],
        },
      ],
    };
  } else if (alicuotas.cantidad >= 1 && cuotas.cantidad >= 1 && tipo == "futuro") {
    templateData = {
      name: "pagos_proximos_total",
      language: {
        policy: "deterministic",
        code: "es",
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: contacto.name,
            },
            {
              type: "text",
              text: "AION CRM",
            },
            {
              type: "text",
              text: cuotas.cantidad,
            },
            {
              type: "currency",
              currency:
        {
          fallback_value: `$${cuotas.monto}`,
          code: "USD",
          amount_1000: cuotas.monto * 1000,
        },
            },
            {
              type: "text",
              text: alicuotas.cantidad,
            },
            {
              type: "currency",
              currency:
        {
          fallback_value: `USD${alicuotas.monto}`,
          code: "USD",
          amount_1000: alicuotas.monto * 1000,
        },
            },
            {
              type: "currency",
              currency:
        {
          fallback_value: `USD${alicuotas.monto + cuotas.monto}`,
          code: "USD",
          amount_1000: (alicuotas.monto + cuotas.monto) * 1000,
        },
            },
          ],
        },
      ],
    };
  } else if ((alicuotas.cantidad >= 2 || cuotas.cantidad >= 2) && tipo == "futuro") {
    templateData = {
      name: "pagos_proximos_tipo",
      language: {
        policy: "deterministic",
        code: "es",
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: contacto.name,
            },
            {
              type: "text",
              text: "AION CRM",
            },
            {
              type: "text",
              text: alicuotas.cantidad > 0 ? alicuotas.cantidad : cuotas.cantidad,
            },
            {
              type: "text",
              text: alicuotas.cantidad > 0 ? "alicuotas" : "cuotas",
            },
            {
              type: "currency",
              currency:
        {
          fallback_value: `$${alicuotas.cantidad > 0 ? alicuotas.monto : cuotas.monto}`,
          code: "USD",
          amount_1000: alicuotas.cantidad > 0 ? alicuotas.monto * 1000 : cuotas.monto * 1000,
        },
            },
          ],
        },
      ],
    };
  } else if ((alicuotas.cantidad == 1 || cuotas.cantidad == 1) && tipo == "futuro") {
    const fecha = alicuotas.cantidad > 0 ? DateTime.fromJSDate(alicuotas.fechas[0]) : DateTime.fromJSDate(cuotas.fechas[0]);
    templateData = {
      name: "pago_proximo",
      language: {
        policy: "deterministic",
        code: "es",
      },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: contacto.name,
            },
            {
              type: "text",
              text: "AION CRM",
            },
            {
              type: "text",
              text: alicuotas.cantidad > 0 ? "alicuotas" : "cuotas",
            },
            {
              type: "date_time",
              date_time: {
                fallback_value: `${fecha.setLocale("es-EC").toLocaleString(DateTime.DATE_FULL)}`,
                day_of_week: fecha.weekday,
                day_of_month: fecha.day,
                year: fecha.year,
                month: fecha.month,
                hour: fecha.hour,
                minute: fecha.minute,
              },
            },
            {
              type: "currency",
              currency: {
                fallback_value: `$${alicuotas.cantidad > 0 ? alicuotas.monto : cuotas.monto}`,
                code: "USD",
                amount_1000: alicuotas.cantidad > 0 ? alicuotas.monto * 1000 : cuotas.monto * 1000,
              },
            },
          ],
        },
      ],
    };
  }

  return templateData;
}

const whatsappNotif = async (_, res) => {
  const db = getFirestore();
  const wa = new WhatsApp();
  try {
    const contactos = await db.collection("contactos").get();

    // Obtenemos el timestamp actual
    const now = Timestamp.now();
    // Calculamos el timestamp para 10 días antes
    const diasDesdeHoy = calculateTimestamps(now, -10);
    // Calculamos el timestamp para 5 días despues
    const diasDespuesHoy = calculateTimestamps(now, 5);

    for (const doc of contactos.docs) {
      const contacto = doc.data();
      console.log(`Procesando contacto: ${doc.id}`);

      const payments = await db.collection("payments")
          .where("contactID", "==", doc.ref)
          .where("isPaid", "==", false)
          .where("planDate", "<=", diasDesdeHoy)
          .get();

      const filteredPayments = payments.docs.filter((paymentDoc) => {
        const paymentData = paymentDoc.data();
        // Verifica si msgSendPrev es false o si no existe
        return (paymentData.msgSendCob === false || !("msgSendCob" in paymentData));
      });

      if (filteredPayments.empty) {
        console.log(`No se encontraron pagos pendientes para el contacto: ${doc.id} de hace 10 días para atrás`);
        continue;
      }
      const alicuotas = await processPayments(filteredPayments, "alicuota");
      const cuotas = await processPayments(filteredPayments, "cuota");

      const templateData = createTemplateData(contacto, alicuotas, cuotas, "vencido");
      await wa.messages.template(templateData, process.env.RECIPIENT_NUMBER);
      // Actualizar pagos procesados
      for (const id of [...alicuotas.idsPago, ...cuotas.idsPago]) {
        const paymentRef = db.collection("payments").doc(id);
        await paymentRef.update({msgSendCob: true});
      }
    }

    for (const doc of contactos.docs) {
      const contacto = doc.data();
      console.log(`Procesando contacto: ${doc.id}`);
      // Procesar pagos futuros
      const paymentsFuture = await db.collection("payments")
          .where("contactID", "==", doc.ref)
          .where("isPaid", "==", false)
          .where("planDate", "<=", diasDespuesHoy)
          .where("planDate", ">=", now)
          .get();

      const filteredPaymentsFuture = paymentsFuture.docs.filter((paymentDoc) => {
        const paymentData = paymentDoc.data();
        // Verifica si msgSendPrev es false o si no existe
        return (paymentData.msgSendPrev === false || !("msgSendPrev" in paymentData));
      });

      if (filteredPaymentsFuture.empty) {
        console.log(`No se encontraron pagos futuros para el contacto: ${doc.id} para los próximos 5 días`);
        continue;
      }
      const alicuotasFuturas = await processPayments(filteredPaymentsFuture, "alicuota");
      const cuotasFuturas = await processPayments(filteredPaymentsFuture, "cuota");

      const templateDataFuture = createTemplateData(contacto, alicuotasFuturas, cuotasFuturas, "futuro");
      await wa.messages.template(templateDataFuture, process.env.RECIPIENT_NUMBER);

      for (const id of [...alicuotasFuturas.idsPago, ...cuotasFuturas.idsPago]) {
        const paymentRef = db.collection("payments").doc(id);
        await paymentRef.update({msgSendPrev: true});
      }
    }
    res.setHeader("Content-Type", "application/json");
    res.status(201).send({message: "Notificaciones enviadas exitósamente."});
  } catch (error) {
    console.log(error);
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

exports.whatsappNotif = onSchedule("30 14 * * 1-5", whatsappNotif);

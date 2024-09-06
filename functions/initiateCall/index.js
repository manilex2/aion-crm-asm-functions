/* eslint-disable max-len */
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const twilio = require("twilio");
const dotenv = require("dotenv");
const envFile = process.env.NODE_ENV === "production" ? ".env.prod" : ".env";
dotenv.config({path: envFile});

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

admin.initializeApp();
setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});

const createCall = async (req, res) => {
  try {
    const from = process.env.TEST_NUMBER_SENDER;
    const to = process.env.TEST_NUMBER;
    const call = await client.calls.create({
      url: process.env.NODE_ENV != "production"? `${process.env.MY_FIREBASE_HOST_URL}/empezarLlamada` : `https://empezarllamada-${process.env.MY_FIREBASE_HOST_URL}`,
      to: to,
      from: from,
    });
    console.log(call.sid);
    res.status(200).send({status: 200, message: `Llamada realizada al ${call.toFormatted} desde el ${call.fromFormatted}`});
  } catch (error) {
    res.status(403).send({status: 403, message: `Ocurrió el siguiente error: ${error}`});
  }
};

exports.iniciarLlamada = onRequest({
  cors: [/aion-crml-asm\.flutterflow\.app$/, /app\.flutterflow\.io\/debug$/],
}, createCall);

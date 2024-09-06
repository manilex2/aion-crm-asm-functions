/* eslint-disable max-len */
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const dotenv = require("dotenv");
const envFile = process.env.NODE_ENV === "production" ? ".env.prod" : ".env";
dotenv.config({path: envFile});
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const VoiceResponse = require("twilio").twiml.VoiceResponse;
const OpenAI = require("openai");
const openai = new OpenAI({
  organization: `${process.env.OPENAI_ORG_ID}`,
  project: `${process.env.OPENAI_PROJECT_ID}`,
  apiKey: `${process.env.OPENAI_API_KEY}`,
});
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

admin.initializeApp({
  storageBucket: process.env.MY_FIREBASE_BUCKET_NAME,
  credential: admin.credential.cert("./credentials.json"),
});

setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});

const processCall = async (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  console.log(recordingUrl);
  const tempFilePath = path.join(__dirname, "recording.mp3");
  let firebaseUrl;
  try {
    await axios({
      url: `${recordingUrl}.mp3`,
      responseType: "stream",
      auth: {
        username: accountSid,
        password: authToken,
      },
      method: "get",
    }).then((response) => {
      const writer = fs.createWriteStream(tempFilePath);
      response.data.pipe(writer);

      writer.on("finish", () => {
        const bucket = admin.storage().bucket();
        // Subir el archivo a Firebase Storage
        bucket.upload(tempFilePath, {
          destination: "audio/recording.mp3",
        }).then(async () => {
          console.log("Archivo subido exitosamente");
          firebaseUrl = await bucket.file("audio/recording.mp3").getSignedUrl({
            action: "read",
            expires: "03-09-9999",
          }).then(async (signedUrls) => {
            firebaseUrl = signedUrls[0];
            // Eliminar el archivo temporal después de subirlo y obtener la URL
            fs.unlinkSync(tempFilePath);
            // Transcribir el audio
            const transcription = await transcribeAudio(firebaseUrl).then((resp) => {
              return resp;
            });
            console.log("Transcription:", transcription);
          }).catch((error) => {
            console.error("Error al obtener la URL de descarga:", error);
          });
        }).catch((err) => {
          console.error("Error al subir el archivo:", err);
        });
      });

      writer.on("error", (err) => {
        console.error("Error al escribir el archivo:", err);
      });
    }).catch((err) => {
      console.error("Error al descargar el archivo:", err);
    });

    // Analizar la transcripción
    /* const analysis = await analyzeResponse(transcription).then((resp) => {
      return resp;
    });
    console.log("Analysis:", analysis); */

    // Generar la respuesta TwiML según el análisis de la transcripción
    /* const twiml = new VoiceResponse();
    if (analysis.message.content.toLowerCase().includes("positiva")) {
      twiml.say("Gracias por confirmar. ¿Podría decirme su número de identificación?");
    } else if (analysis.message.content.toLowerCase().includes("negativa")) {
      twiml.say("Oh, disculpe las molestias tenga una feliz tarde");
    } else {
      twiml.say("Lo siento, no lo he entendido. ¿Podría repetir?");
    } */
    /* twiml.record({
      maxLength: 10,
      action: "https://your-region-your-project.cloudfunctions.net/processRecording",
    }); */
    /* await twiml.hangup();
    res.type("text/xml");
    res.status(200).send(twiml.toString()); */
    res.status(200).send("Hola Mundo");
  } catch (error) {
    console.error("Error downloading the audio file:", error);
    res.status(403).send({status: 403, message: `Ocurrió el siguiente error: ${error}`});
  }
};

/**
 * Producir texto a partir de un audio con OpenAI
 * @param {string} filePath Ruta del archivo de audio
 * @return {string} El texto transcrito del audio
 */
async function transcribeAudio(filePath) {
  const response = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file: filePath,
  });

  return response.text;
}

/**
 * Analizar si es positiva, negativa o no hubo respuesta con OpenAI
 * @param {string} transcription Texto que se va a analizar
 * @return {string} El texto transcrito del audio
 */
async function analyzeResponse(transcription) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{role: "user", content: `El usuario dijo: ${transcription}. Es la respuesta positiva, negativa o no dió respuesta?`}],
    max_tokens: 20,
    response_format: {type: "text"},
  });

  return response.choices[0];
}

exports.procesarLlamada = onRequest({
  cors: [/aion-crml-asm\.flutterflow\.app$/, /app\.flutterflow\.io\/debug$/],
}, processCall);

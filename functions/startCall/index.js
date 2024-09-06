/* eslint-disable max-len */
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const dotenv = require("dotenv");
const envFile = process.env.NODE_ENV === "production" ? ".env.prod" : ".env";
dotenv.config({path: envFile});
const VoiceResponse = require("twilio").twiml.VoiceResponse;
const OpenAI = require("openai");
const openai = new OpenAI({
  organization: `${process.env.OPENAI_ORG_ID}`,
  project: `${process.env.OPENAI_PROJECT_ID}`,
  apiKey: `${process.env.OPENAI_API_KEY}`,
});

admin.initializeApp({
  storageBucket: process.env.MY_FIREBASE_BUCKET_NAME,
  credential: admin.credential.cert("./credentials.json"),
});

setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});

const startCall = async (req, res) => {
  try {
    const audioResult = await generateVoice("Buenas tardes me comunico de Cohete Azul, ¿Estoy hablando con el señor Manuel Pereira?").then((result) => {
      return result;
    });
    const twiml = new VoiceResponse();
    twiml.play(await audioResult);
    twiml.record({
      maxLength: 4,
      action: process.env.NODE_ENV != "production"? `${process.env.MY_FIREBASE_HOST_URL}/procesarLlamada` : `https://procesarllamada-${process.env.MY_FIREBASE_HOST_URL}`,
      playBeep: false,
    });
    res.status(200).send(twiml.toString());
    // res.status(200).send({audioURL: audioResult});
  } catch (error) {
    res.status(403).send({status: 403, message: `Ocurrió el siguiente error: ${error}`});
  }
};

/**
 * Producir audio a partir de un texto con OpenAI
 * @param {string} text Texto que se va a transformar
 * @return {string} La url del audio
 */
async function generateVoice(text) {
  const file = admin.storage().bucket().file("audio/audio.mp3");
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: process.env.VOICE_GPT,
    input: text,
  });
  const buffer = Buffer.from(await mp3.arrayBuffer());
  await file.save(buffer, {
    contentType: "audio/mpeg",
  });

  const [url] = await file.getSignedUrl({
    action: "read",
    expires: "03-09-9999",
  });
  return url;
}

exports.empezarLlamada = onRequest({
  cors: [/aion-crml-asm\.flutterflow\.app$/, /app\.flutterflow\.io\/debug$/],
}, startCall);

/* eslint-disable max-len */
require("dotenv").config("./.env");
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const {getFirestore} = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");

admin.initializeApp();
setGlobalOptions({
  maxInstances: 10,
  timeoutSeconds: 540,
  memory: "1GiB",
});

/**
    * Crear una cadena de caracteres aleatoria.
    * @return {string} La cadena aleatoria de caracteres.
    */
function claveProv() {
  const saltRounds = 10;
  return new Promise((resolve, reject) => {
    bcrypt.genSalt(saltRounds, (err, salt) => {
      if (err) {
        reject(err);
      } else {
        resolve(salt);
      }
    });
  });
}

const singUp = async (req, res) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SENDGRID_HOST,
    port: process.env.SENDGRID_PORT,
    auth: {
      user: process.env.SENDGRID_USER,
      pass: process.env.SENDGRID_API_KEY,
    },
  });

  const body = req.body;
  const clave = await claveProv().then((salt) => {
    return salt;
  }).catch((error) => {
    console.error(error);
    return error;
  });
  const auth = admin.auth();
  const db = getFirestore();
  try {
    const instRef = (await db.collection("institution").doc(`${body.institution_id}`).get()).ref;
    const users = (await db.collection("users").where("institutionId", "==", instRef).get()).docs.map((user) => {
      return user.data();
    });
    const created = users.some((resp) => resp.email === req.body.email);
    if (!created) {
      const newUserRef = db.collection("users").doc();
      const user = {
        email: body.email,
        displayName: body.display_name,
        password: `${clave}`,
      };
      try {
        const userFirebase = await auth.createUser({...user, uid: `${newUserRef.id}`});
        console.log("Usuario creado con éxito:", userFirebase.uid);
        try {
          transporter.sendMail({
            from: `${process.env.SENDGRID_SENDER_NAME} ${process.env.SENDGRID_SENDER_EMAIL}`,
            to: `${body.email}`,
            subject: `Registro de usuario exitoso en ${process.env.AION_NAME}`,
            html: `<p>Hola ${body.display_name}, has sido registrado en la plataforma de ${process.env.AION_NAME}.</p><p>Esta es su clave: <b>${clave}</b></p><p>Al iniciar sesión se le solicitará cambiarla.</p><p>Este es el link <a href="${process.env.AION_URL}">${process.env.AION_NAME}</a></p><p>Atentamente</p><p><b>El equipo de ${process.env.AION_NAME}</b></p>`,
          }, (err, info) => {
            if (err) {
              console.log(err);
            } else {
              console.log(info);
            }
          }),
          (err) => {
            if (err) {
              console.log(err);
              throw new Error(err);
            }
          };
        } catch (error) {
          throw new Error(error);
        }
        const usuario = {
          email: body.email,
          display_name: body.display_name,
          photo_url: !body.photo_url? "" : body.photo_url,
          phone_number: body.phone_number,
          rol: body.rol.toLowerCase(),
          uid: userFirebase.uid,
          created_time: new Date(userFirebase.metadata.creationTime),
          enable: body.enable,
          institutionId: instRef,
          firstLogin: true,
        };
        newUserRef.set(usuario);
      } catch (error) {
        console.error("Error al crear usuario:", error);
        throw new Error(error);
      }
    } else {
      throw new Error("El usuario ya se encuentra creado.");
    }
    res.status(201).send({status: 200, message: "Usuario creado exitósamente."});
  } catch (error) {
    res.status(403).send({status: 403, message: `Ocurrió el siguiente error: ${error}`});
  }
};

exports.singUp = onRequest(
    {cors: [/aion-crml-asm\.flutterflow\.app$/, /app\.flutterflow\.io\/debug$/]},
    singUp,
);

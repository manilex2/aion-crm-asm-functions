/* eslint-disable max-len */
require("dotenv").config("./.env");
const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const {getFirestore} = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const aws = require("@aws-sdk/client-ses");
const {defaultProvider} = require("@aws-sdk/credential-provider-node");
const AWS = require("aws-sdk");

const credentials = new AWS.SharedIniFileCredentials({profile: "manuel"});

const ses = new aws.SES({
  apiVersion: "2010-12-01",
  region: "us-east-2",
  defaultProvider,
});

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
  console.log(credentials);
  AWS.config.credentials = credentials;
  AWS.config.getCredentials((err) => {
    if (err) console.log(err.stack);
    // credentials not loaded
    else {
      console.log("Access key:", AWS.config.credentials.accessKeyId);
    }
  });
  const transporter = nodemailer.createTransport({
    SES: {ses, aws},
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
            from: "notificaciones@aionadmin.com",
            to: `${body.email}`,
            subject: "Mensaje de prueba",
            text: "Hola esto es un mensaje de prueba",
            ses: {
              // optional extra arguments for SendRawEmail
              Tags: [
                {
                  Name: "tag_name",
                  Value: "tag_value",
                },
              ],
            },
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
          rol: body.rol,
          uid: userFirebase.uid,
          created_time: new Date(userFirebase.metadata.creationTime),
          enabled: true,
          instId: instRef,
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

exports.singUp = onRequest(singUp);

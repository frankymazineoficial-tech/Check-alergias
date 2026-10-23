// Configuración del servidor de Comeclaro (Firebase). Estos valores no son secretos: la seguridad la ponen las reglas.
window.TUSALERGIAS_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAvbqJDtzn0cWwUvgcjk1X2WzaK2Y7fGSM",
  authDomain: "tus-alergias.firebaseapp.com",
  projectId: "tus-alergias",
  storageBucket: "tus-alergias.firebasestorage.app",
  messagingSenderId: "523118654382",
  appId: "1:523118654382:web:1579ba08fbccfb87064e3f"
};

// Dirección pública de la app (la que llevan los QR de las mesas). No la cambies después de imprimir carteles.
window.TUSALERGIAS_PUBLIC_URL = "https://comeclaro.es/";

// Protección contra programas automáticos (Firebase App Check con reCAPTCHA).
// Déjala en "PEGA_AQUI" hasta activarla con la guía de seguridad: la app funciona igual.
window.COMECLARO_APPCHECK_KEY = "PEGA_AQUI";
window.COMECLARO_APPCHECK_TIPO = "enterprise";

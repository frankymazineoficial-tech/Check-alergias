// =====================================================================
// CONFIGURACIÓN DEL SERVIDOR DE TUSALERGIAS (Firebase)
//
// Mientras este archivo tenga los valores "PEGA_AQUI", la app funciona en
// MODO DE PRUEBA: todo se guarda solo en el móvil de cada persona.
//
// Para activar el servidor (cuentas reales, cartas en la nube y QR corto):
//   1. Consola de Firebase → Configuración del proyecto → Tus apps → Web.
//   2. Copia los 6 valores de "firebaseConfig" y pégalos abajo entre comillas.
//   3. Guarda el archivo y súbelo a GitHub junto a index.html.
// Estos valores no son secretos: la seguridad la ponen las reglas (firestore.rules).
// =====================================================================
window.TUSALERGIAS_FIREBASE_CONFIG = {
  apiKey: "PEGA_AQUI",
  authDomain: "PEGA_AQUI",
  projectId: "PEGA_AQUI",
  storageBucket: "PEGA_AQUI",
  messagingSenderId: "PEGA_AQUI",
  appId: "PEGA_AQUI"
};

// Dirección pública de la app. Se usa en los QR de las mesas, así que ponla
// antes de imprimir carteles (por ejemplo "https://tusalergias.es/").
// Déjala en "PEGA_AQUI" para usar la dirección desde la que se abre la app.
window.TUSALERGIAS_PUBLIC_URL = "PEGA_AQUI";

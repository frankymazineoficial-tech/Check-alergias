// Pruebas de las reglas de seguridad de Comeclaro (3.12.2) contra el EMULADOR OFICIAL de Firestore.
// Cada «debe FALLAR» va acompañado de un «debe FUNCIONAR» parecido, para que un fallo de la
// propia prueba no pase por seguridad.
const fs = require('fs');
const crypto = require('crypto');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const firebase = require('firebase/compat/app');
require('firebase/compat/firestore');

const FV = firebase.firestore.FieldValue, TS = firebase.firestore.Timestamp;
const ST = () => FV.serverTimestamp();
const DAY = 86400000;
const inDays = n => TS.fromMillis(Date.now() + n * DAY);
const ADMIN_EMAIL = 'frankymazineoficial@gmail.com';

let env;
const ctxs = {};
const db = {
  anon: () => env.unauthenticatedContext().firestore(),          // sin sesión
  guest: uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore(), // cliente anónimo
  owner: (uid, verified = true) => env.authenticatedContext(uid, { email: uid + '@ejemplo.es', email_verified: verified, firebase: { sign_in_provider: 'password' } }).firestore(),
  admin: () => env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true, firebase: { sign_in_provider: 'google.com' } }).firestore(),
  adminWithPassword: () => env.authenticatedContext('adm', { email: ADMIN_EMAIL, email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore(),
  fakeAdminUnverified: () => env.authenticatedContext('adm2', { email: ADMIN_EMAIL, email_verified: false, firebase: { sign_in_provider: 'password' } }).firestore(),
  fakeAdminOtherMail: () => env.authenticatedContext('adm3', { email: 'otro@gmail.com', email_verified: true, firebase: { sign_in_provider: 'password' } }).firestore()
};
const seed = fn => env.withSecurityRulesDisabled(c => fn(c.firestore()));
// 3.12: cada opinión, sugerencia y denuncia nueva suma 1 en quotas/{uid} en la misma operación
function qset(d, uid, kind, ref, path, data, extra = []) {
  const b = d.batch();
  b.set(d.doc(path), data);
  extra.forEach(([pp, dd]) => b.set(d.doc(pp), dd));
  b.set(d.doc('quotas/' + uid), { win: ST(), rev: 0, sug: 0, rep: 0, [kind]: 1, at: ST(), ref });
  return b.commit();
}

const CREATED = TS.fromMillis(Date.now() - 10 * DAY);
const rest = (uid, n, extra = {}) => ({
  ownerUid: uid, name: 'Bar Prueba', city: 'Lorca', phone: '600123456', lat: 37.67, lng: -1.7,
  lastVerified: '2026-10-01', published: true, dishCount: 1, updatedAt: TS.now(), createdAt: CREATED, instance: 'inst12345', ...extra
});
const restNew = (uid, extra = {}) => ({ ...rest(uid, 1), updatedAt: ST(), createdAt: ST(), ...extra });
const review = (uid, extra = {}) => ({ author: 'Ana', stars: 4, allergens: 'GLUTEN', comment: 'Todo bien', isAlert: false, authorUid: uid, createdAt: TS.now(), ...extra });
const reviewNew = (uid, extra = {}) => ({ ...review(uid), createdAt: ST(), ...extra });
const ownerDocSeed = (uid, extra = {}) => ({ email: uid + '@ejemplo.es', plan: 'lanzamiento', founderNumber: 0, termsVersion: '1', termsAcceptedAt: TS.now(), createdAt: TS.now(), ...extra });

let pass = 0, fail = 0;
const failed = [];
async function t(name, setup, run) {
  try {
    await env.clearFirestore();
    if (setup) await setup();
    await run();
    pass++; console.log('  ✔ ' + name);
  } catch (e) {
    fail++; failed.push(name); console.log('  ✘ ' + name + '\n      ' + String(e.message || e).split('\n')[0].slice(0, 220));
  }
}
const sec = s => console.log('\n' + s);
const R = (db_, p) => db_.doc(p);

(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-tusalergias', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
  const seedRest = (uid, n = 1, extra = {}) => seed(d => d.doc(`restaurants/${uid}_${n}`).set(rest(uid, n, extra)));

  sec('1) Administración: nadie se hace pasar por ella');
  await t('admin real lee aiUsage', () => seed(d => d.doc('aiUsage/a').set({ x: 1 })), () => assertSucceeds(R(db.admin(), 'aiUsage/a').get()));
  await t('mismo email SIN verificar NO lee aiUsage', () => seed(d => d.doc('aiUsage/a').set({ x: 1 })), () => assertFails(R(db.fakeAdminUnverified(), 'aiUsage/a').get()));
  await t('email verificado de otra persona NO lee aiUsage', () => seed(d => d.doc('aiUsage/a').set({ x: 1 })), () => assertFails(R(db.fakeAdminOtherMail(), 'aiUsage/a').get()));
  await t('cliente anónimo NO lee aiUsage', () => seed(d => d.doc('aiUsage/a').set({ x: 1 })), () => assertFails(R(db.guest('c1'), 'aiUsage/a').get()));
  await t('nadie escribe aiUsage (ni la administración)', null, () => assertFails(R(db.admin(), 'aiUsage/b').set({ x: 1 })));
  await t('purchases cerrado a todos (ni lectura de admin)', () => seed(d => d.doc('purchases/p').set({ x: 1 })), () => assertFails(R(db.admin(), 'purchases/p').get()));
  await t('purchases cerrado a escritura de un dueño', null, () => assertFails(R(db.owner('own1'), 'purchases/p').set({ x: 1 })));
  await t('colección desconocida cerrada (lectura)', () => seed(d => d.doc('secretos/s').set({ x: 1 })), () => assertFails(R(db.admin(), 'secretos/s').get()));

  sec('2) Locales');
  await t('cualquiera (sin sesión) lee un local', () => seedRest('own1'), () => assertSucceeds(R(db.anon(), 'restaurants/own1_1').get()));
  await t('el dueño crea su local own1_1', null, () => assertSucceeds(R(db.owner('own1'), 'restaurants/own1_1').set(restNew('own1'))));
  await t('NO se crea el local de otra cuenta (own2_1 siendo own1)', null, () => assertFails(R(db.owner('own1'), 'restaurants/own2_1').set(restNew('own2'))));
  await t('NO se crea own1_4 (solo 1 a 3)', null, () => assertFails(R(db.owner('own1'), 'restaurants/own1_4').set(restNew('own1'))));
  await t('un cliente anónimo NO crea local', null, () => assertFails(R(db.guest('anon1'), 'restaurants/anon1_1').set(restNew('anon1'))));
  await t('NO se crea un local con paidUntil (pago falso)', null, () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').set(restNew('own1', { paidUntil: inDays(365) }))));
  await t('NO se crea un local ya verificado', null, () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').set(restNew('own1', { verified: true }))));
  await t('NO se crea un local Fundador si la cuenta no lo es', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1'))), () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').set(restNew('own1', { founder: true }))));
  await t('se crea un local Fundador si la cuenta SÍ lo es', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1', { founderNumber: 3 }))), () => assertSucceeds(R(db.owner('own1'), 'restaurants/own1_1').set(restNew('own1', { founder: true }))));
  await t('NO se crea el hueco de un local traspasado', () => seed(d => d.doc('redirects/own1_1').set({ to: 'otro_1', at: TS.now() })), () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').set(restNew('own1'))));
  await t('el dueño actualiza su local (platos)', () => seedRest('own1'), () => assertSucceeds(R(db.owner('own1'), 'restaurants/own1_1').update({ dishCount: 5, updatedAt: ST() })));
  await t('otra cuenta NO actualiza el local ajeno', () => seedRest('own1'), () => assertFails(R(db.owner('own2'), 'restaurants/own1_1').update({ dishCount: 5, updatedAt: ST() })));
  await t('el dueño NO se pone paidUntil', () => seedRest('own1'), () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').update({ paidUntil: inDays(400), updatedAt: ST() })));
  await t('el dueño NO se verifica a sí mismo', () => seedRest('own1'), () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').update({ verified: true, updatedAt: ST() })));
  await t('el dueño NO se pone la insignia Fundador sin serlo', () => seed(async d => { await d.doc('owners/own1').set(ownerDocSeed('own1')); await d.doc('restaurants/own1_1').set(rest('own1', 1)); }), () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').update({ founder: true, updatedAt: ST() })));
  await t('cambiar el nombre de un local verificado SIN quitar verified falla', () => seedRest('own1', 1, { verified: true, verifiedAt: TS.now() }), () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').update({ name: 'Nombre nuevo', updatedAt: ST() })));
  await t('cambiar el nombre quitando verified funciona', () => seedRest('own1', 1, { verified: true, verifiedAt: TS.now() }), () => assertSucceeds(R(db.owner('own1'), 'restaurants/own1_1').update({ name: 'Nombre nuevo', verified: false, updatedAt: ST() })));
  await t('la administración verifica un local', () => seedRest('own1'), () => assertSucceeds(R(db.admin(), 'restaurants/own1_1').update({ verified: true, verifiedAt: ST() })));
  await t('la administración NO cambia otros campos (precio/paidUntil) por esta vía', () => seedRest('own1'), () => assertFails(R(db.admin(), 'restaurants/own1_1').update({ paidUntil: inDays(30) })));
  await t('el dueño NO borra su local sin dejar registro', () => seedRest('own1'), () => assertFails(R(db.owner('own1'), 'restaurants/own1_1').delete()));
  await t('el dueño borra su local dejando registro en deletedLocals', () => seedRest('own1'), () => {
    const d = db.owner('own1'), b = d.batch();
    b.set(d.doc('deletedLocals/own1_1_inst12345'), { rid: 'own1_1', name: 'Bar Prueba', city: 'Lorca', ownerUid: 'own1', reviews: 0, at: ST() });
    b.delete(d.doc('restaurants/own1_1'));
    return assertSucceeds(b.commit());
  });
  await t('otra cuenta NO borra el local ajeno (ni con registro)', () => seedRest('own1'), () => {
    const d = db.owner('own2'), b = d.batch();
    b.set(d.doc('deletedLocals/own1_1_inst12345'), { rid: 'own1_1', name: 'Bar Prueba', city: 'Lorca', ownerUid: 'own2', reviews: 0, at: ST() });
    b.delete(d.doc('restaurants/own1_1'));
    return assertFails(b.commit());
  });
  await t('la administración borra un local', () => seedRest('own1'), () => assertSucceeds(R(db.admin(), 'restaurants/own1_1').delete()));
  await t('deletedLocals: lo lee la administración', () => seed(d => d.doc('deletedLocals/x').set({ rid: 'a' })), () => assertSucceeds(R(db.admin(), 'deletedLocals/x').get()));
  await t('deletedLocals: NO lo lee un dueño', () => seed(d => d.doc('deletedLocals/x').set({ rid: 'a' })), () => assertFails(R(db.owner('own1'), 'deletedLocals/x').get()));

  sec('3) Cartas, borradores y cobro');
  const menuNew = (ver, base, extra = {}) => ({ menu: [], updatedAt: ST(), ver, base, ...extra });
  await t('el dueño crea su carta', () => seedRest('own1'), () => assertSucceeds(R(db.owner('own1'), 'menus/own1_1').set(menuNew('v1234567', ''))));
  await t('otra cuenta NO crea la carta ajena', () => seedRest('own1'), () => assertFails(R(db.owner('own2'), 'menus/own1_1').set(menuNew('v1234567', ''))));
  await t('carta con 301 platos rechazada', () => seedRest('own1'), () => assertFails(R(db.owner('own1'), 'menus/own1_1').set(menuNew('v1234567', '', { menu: Array.from({ length: 301 }, (_, i) => ({ id: i })) }))));
  await t('carta con 300 platos aceptada', () => seedRest('own1'), () => assertSucceeds(R(db.owner('own1'), 'menus/own1_1').set(menuNew('v1234567', '', { menu: Array.from({ length: 300 }, (_, i) => ({ id: i })) }))));
  const seedMenu = () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('menus/own1_1').set({ menu: [], updatedAt: TS.now(), ver: 'v1234567', base: '' }); });
  await t('guardar sobre una versión vieja de la carta se RECHAZA', seedMenu, () => assertFails(R(db.owner('own1'), 'menus/own1_1').update(menuNew('v7654321', 'zzzzzzzz'))));
  await t('guardar sobre la última versión funciona', seedMenu, () => assertSucceeds(R(db.owner('own1'), 'menus/own1_1').update(menuNew('v7654321', 'v1234567'))));
  await t('sin cobro, la carta es pública (sin sesión)', seedMenu, () => assertSucceeds(R(db.anon(), 'menus/own1_1').get()));
  const billing = () => seed(async d => {
    await d.doc('meta/plan').set({ billingStartsAt: inDays(-30), noticeText: '', playBilling: true, webBilling: true, updatedAt: TS.now() });
    await d.doc('restaurants/own1_1').set(rest('own1', 1));
    await d.doc('menus/own1_1').set({ menu: [], updatedAt: TS.now(), ver: 'v1234567', base: '' });
    await d.doc('restaurants/own2_1').set(rest('own2', 1, { paidUntil: inDays(20) }));
    await d.doc('menus/own2_1').set({ menu: [], updatedAt: TS.now(), ver: 'v1234567', base: '' });
    await d.doc('restaurants/own3_1').set(rest('own3', 1, { founder: true }));
    await d.doc('menus/own3_1').set({ menu: [], updatedAt: TS.now(), ver: 'v1234567', base: '' });
  });
  await t('con cobro activo, local SIN pagar: carta cerrada al público', billing, () => assertFails(R(db.anon(), 'menus/own1_1').get()));
  await t('con cobro activo, local al día: carta abierta al público', billing, () => assertSucceeds(R(db.anon(), 'menus/own2_1').get()));
  await t('con cobro activo, Fundador en su año gratis: carta abierta', billing, () => assertSucceeds(R(db.anon(), 'menus/own3_1').get()));
  await t('con cobro activo, el dueño sin pagar sigue viendo su carta', billing, () => assertSucceeds(R(db.owner('own1'), 'menus/own1_1').get()));
  await t('borradores: los lee su dueño', () => seed(d => d.doc('drafts/own1_1').set({ menu: [], order: [], updatedAt: TS.now() })), () => assertSucceeds(R(db.owner('own1'), 'drafts/own1_1').get()));
  await t('borradores: NO los lee otra cuenta ni un cliente', () => seed(d => d.doc('drafts/own1_1').set({ menu: [], order: [], updatedAt: TS.now() })), async () => { await assertFails(R(db.owner('own2'), 'drafts/own1_1').get()); await assertFails(R(db.anon(), 'drafts/own1_1').get()); });
  await t('borradores: su dueño los escribe', null, () => assertSucceeds(R(db.owner('own1'), 'drafts/own1_1').set({ menu: [], order: [], updatedAt: ST() })));
  const plan = (days) => ({ billingStartsAt: days === null ? null : inDays(days), noticeText: 'Aviso', playBilling: true, webBilling: true, updatedAt: ST() });
  await t('plan: la administración fija cobro a 40 días', null, () => assertSucceeds(R(db.admin(), 'meta/plan').set(plan(40))));
  await t('plan: fecha a 10 días se RECHAZA (faltan 30 días de aviso)', null, () => assertFails(R(db.admin(), 'meta/plan').set(plan(10))));
  await t('plan: la administración lo apaga (fecha nula)', null, () => assertSucceeds(R(db.admin(), 'meta/plan').set(plan(null))));
  await t('plan: un dueño NO lo cambia', null, () => assertFails(R(db.owner('own1'), 'meta/plan').set(plan(40))));
  await t('plan: lectura pública', () => seed(d => d.doc('meta/plan').set({ billingStartsAt: null, noticeText: '', playBilling: true, webBilling: true, updatedAt: TS.now() })), () => assertSucceeds(R(db.anon(), 'meta/plan').get()));

  sec('4) Cuentas de restaurante y plazas de Fundador');
  const ownerNew = (uid, n, extra = {}) => ({ email: uid + '@ejemplo.es', plan: 'lanzamiento', founderNumber: n, termsVersion: '1', termsAcceptedAt: ST(), createdAt: ST(), ...extra });
  await t('crear mi perfil sin plaza de Fundador', null, () => assertSucceeds(R(db.owner('own1'), 'owners/own1').set(ownerNew('own1', 0))));
  await t('NO crear el perfil de otra cuenta', null, () => assertFails(R(db.owner('own1'), 'owners/own2').set(ownerNew('own2', 0))));
  await t('NO crear perfil con plan de pago', null, () => assertFails(R(db.owner('own1'), 'owners/own1').set(ownerNew('own1', 0, { plan: 'pro' }))));
  await t('NO crear perfil con un email que no es el mío', null, () => assertFails(R(db.owner('own1'), 'owners/own1').set(ownerNew('own1', 0, { email: 'otro@x.es' }))));
  await t('un cliente anónimo NO crea perfil', null, () => assertFails(R(db.guest('c1'), 'owners/c1').set(ownerNew('c1', 0))));
  await t('NO leer el perfil ajeno', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1'))), () => assertFails(R(db.owner('own2'), 'owners/own1').get()));
  await t('leer el perfil propio', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1'))), () => assertSucceeds(R(db.owner('own1'), 'owners/own1').get()));
  await t('la administración lee cualquier perfil', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1'))), () => assertSucceeds(R(db.admin(), 'owners/own1').get()));
  await t('aceptar condiciones nuevas', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1'))), () => assertSucceeds(R(db.owner('own1'), 'owners/own1').update({ termsVersion: '2', termsAcceptedAt: ST() })));
  await t('NO cambiarme el plan a mano', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1'))), () => assertFails(R(db.owner('own1'), 'owners/own1').update({ plan: 'pro' })));
  await t('NO ponerme paidUntil/suscripción a mano', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1'))), () => assertFails(R(db.owner('own1'), 'owners/own1').update({ paidUntil: inDays(365), sub: 'x' })));
  const claim1 = (uid, n, verified = true) => { const d = db.owner(uid, verified), b = d.batch(); b.set(d.doc('owners/' + uid), ownerNew(uid, n)); b.set(d.doc('meta/founders'), { count: 1, revoked: 0 }); b.set(d.doc('founderMarks/' + uid), { n }); return b.commit(); };
  await t('primer Fundador (email verificado): plaza 1', null, () => assertSucceeds(claim1('own1', 1)));
  await t('Fundador con el email SIN verificar se rechaza', null, () => assertFails(claim1('own1', 1, false)));
  await t('primer Fundador NO puede coger la plaza 2', null, () => assertFails((() => { const d = db.owner('own1'), b = d.batch(); b.set(d.doc('owners/own1'), ownerNew('own1', 2)); b.set(d.doc('meta/founders'), { count: 2, revoked: 0 }); b.set(d.doc('founderMarks/own1'), { n: 2 }); return b.commit(); })()));
  const claimNext = (uid, n, newCount) => { const d = db.owner(uid), b = d.batch(); b.set(d.doc('owners/' + uid), ownerNew(uid, n)); b.update(d.doc('meta/founders'), { count: newCount }); b.set(d.doc('founderMarks/' + uid), { n }); return b.commit(); };
  await t('segunda cuenta: plaza 2 (contador 1→2)', () => seed(d => d.doc('meta/founders').set({ count: 1, revoked: 0 })), () => assertSucceeds(claimNext('own2', 2, 2)));
  await t('el contador NO salta de 1 a 3', () => seed(d => d.doc('meta/founders').set({ count: 1, revoked: 0 })), () => assertFails(claimNext('own2', 3, 3)));
  await t('plaza 30 (contador 29→30) funciona', () => seed(d => d.doc('meta/founders').set({ count: 29, revoked: 0 })), () => assertSucceeds(claimNext('own30', 30, 30)));
  await t('plaza 31 (contador 30→31) se RECHAZA', () => seed(d => d.doc('meta/founders').set({ count: 30, revoked: 0 })), () => assertFails(claimNext('own31', 31, 31)));
  await t('plaza 31 con una plaza retirada (revoked 1) funciona', () => seed(d => d.doc('meta/founders').set({ count: 30, revoked: 1 })), () => assertSucceeds((() => { const d = db.owner('own31'), b = d.batch(); b.set(d.doc('owners/own31'), ownerNew('own31', 31)); b.update(d.doc('meta/founders'), { count: 31 }); b.set(d.doc('founderMarks/own31'), { n: 31 }); return b.commit(); })()));
  await t('una cuenta con marca de Fundador NO repite plaza', () => seed(async d => { await d.doc('meta/founders').set({ count: 1, revoked: 0 }); await d.doc('founderMarks/own2').set({ n: 1 }); }), () => assertFails(claimNext('own2', 2, 2)));
  await t('contador público: lo lee cualquiera', () => seed(d => d.doc('meta/founders').set({ count: 1, revoked: 0 })), () => assertSucceeds(R(db.anon(), 'meta/founders').get()));
  await t('contador: NO se baja a mano', () => seed(d => d.doc('meta/founders').set({ count: 5, revoked: 0 })), () => assertFails(R(db.owner('own1'), 'meta/founders').update({ count: 4 })));
  await t('la administración retira una plaza de Fundador', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1', { founderNumber: 1 }))), () => assertSucceeds(R(db.admin(), 'owners/own1').update({ founderNumber: 0, founderRevokedAt: ST() })));
  await t('otra cuenta NO retira plazas', () => seed(d => d.doc('owners/own1').set(ownerDocSeed('own1', { founderNumber: 1 }))), () => assertFails(R(db.owner('own2'), 'owners/own1').update({ founderNumber: 0, founderRevokedAt: ST() })));

  sec('5) Opiniones y avisos');
  const seedR = () => seedRest('own1');
  await t('opiniones: lectura pública', () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('restaurants/own1_1/reviews/c1').set(review('c1')); }), () => assertSucceeds(R(db.anon(), 'restaurants/own1_1/reviews/c1').get()));
  await t('un cliente anónimo publica su opinión', seedR, () => assertSucceeds(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1'))));
  await t('sin sesión NO se opina', seedR, () => assertFails(R(db.anon(), 'restaurants/own1_1/reviews/c1').set(reviewNew('c1'))));
  await t('NO se opina con el identificador de otra persona', seedR, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c2', 'restaurants/own1_1/reviews/c2', reviewNew('c2'))));
  await t('NO se opina con authorUid falso', seedR, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c2'))));
  await t('NO 6 estrellas', seedR, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1', { stars: 6 }))));
  await t('NO comentario vacío', seedR, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1', { comment: '' }))));
  await t('NO comentario de más de 1000 caracteres', seedR, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1', { comment: 'a'.repeat(1001) }))));
  await t('NO campos extra en la opinión', seedR, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1', { admin: true }))));
  await t('NO opinión con fecha falsa', seedR, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1', { createdAt: inDays(-100) }))));
  await t('NO opinar en un local que no existe', null, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'nadie_1/c1', 'restaurants/nadie_1/reviews/c1', reviewNew('c1'))));
  await t('aviso de carta (<uid>_aviso) con isAlert true', seedR, () => assertSucceeds(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1_aviso', 'restaurants/own1_1/reviews/c1_aviso', reviewNew('c1', { isAlert: true }))));
  await t('aviso con isAlert false en id _aviso se RECHAZA', seedR, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1_aviso', 'restaurants/own1_1/reviews/c1_aviso', reviewNew('c1', { isAlert: false }))));
  await t('el DUEÑO no valora su propio local', seedR, () => assertFails(qset(db.owner('own1'), 'own1', 'rev', 'own1_1/own1', 'restaurants/own1_1/reviews/own1', reviewNew('own1'))));
  const seedRv = () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('restaurants/own1_1/reviews/c1').set(review('c1')); });
  await t('el autor borra su opinión', seedRv, () => assertSucceeds(R(db.guest('c1'), 'restaurants/own1_1/reviews/c1').delete()));
  await t('otra persona NO borra la opinión', seedRv, () => assertFails(R(db.guest('c2'), 'restaurants/own1_1/reviews/c1').delete()));
  await t('el DUEÑO NO borra opiniones de su local', seedRv, () => assertFails(R(db.owner('own1'), 'restaurants/own1_1/reviews/c1').delete()));
  await t('la administración borra una opinión', seedRv, () => assertSucceeds(R(db.admin(), 'restaurants/own1_1/reviews/c1').delete()));
  await t('el dueño responde a una opinión', seedRv, () => assertSucceeds(R(db.owner('own1'), 'restaurants/own1_1/reviews/c1').update({ reply: 'Gracias', replyAt: ST() })));
  await t('otra cuenta NO responde en un local ajeno', seedRv, () => assertFails(R(db.owner('own2'), 'restaurants/own1_1/reviews/c1').update({ reply: 'Gracias', replyAt: ST() })));
  await t('el dueño NO cambia las estrellas', seedRv, () => assertFails(R(db.owner('own1'), 'restaurants/own1_1/reviews/c1').update({ stars: 5 })));
  await t('el dueño NO responde con más de 500 caracteres', seedRv, () => assertFails(R(db.owner('own1'), 'restaurants/own1_1/reviews/c1').update({ reply: 'a'.repeat(501), replyAt: ST() })));
  const KEY = 'k'.repeat(40), HASH = crypto.createHash('sha256').update(KEY).digest('hex');
  const seedHashed = () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('restaurants/own1_1/reviews/c1').set(review('c1', { delHash: HASH })); });
  const delWithKey = key => { const d = db.guest('c9'), b = d.batch(); b.set(d.doc('restaurants/own1_1/reviewDeletes/c1'), { key, at: ST() }); b.delete(d.doc('restaurants/own1_1/reviews/c1')); return b.commit(); };
  await t('borrar con la llave secreta correcta (otro usuario)', seedHashed, () => assertSucceeds(delWithKey(KEY)));
  await t('borrar con una llave equivocada se RECHAZA', seedHashed, () => assertFails(delWithKey('x'.repeat(40))));
  await t('reviewDeletes: nadie las lee', () => seed(d => d.doc('restaurants/own1_1/reviewDeletes/c1').set({ key: KEY, at: TS.now() })), () => assertFails(R(db.owner('own1'), 'restaurants/own1_1/reviewDeletes/c1').get()));

  sec('6) Estadísticas');
  await t('cualquiera crea las estadísticas con 1 visita', seedR, () => assertSucceeds(R(db.anon(), 'stats/own1_1').set({ views: 1 })));
  await t('NO crear con 500 visitas', seedR, () => assertFails(R(db.anon(), 'stats/own1_1').set({ views: 500 })));
  const seedSt = () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('stats/own1_1').set({ views: 10, saves: 2 }); });
  await t('sumar 1 visita', seedSt, () => assertSucceeds(R(db.anon(), 'stats/own1_1').update({ views: 11 })));
  await t('NO sumar 5 de golpe', seedSt, () => assertFails(R(db.anon(), 'stats/own1_1').update({ views: 15 })));
  await t('NO restar visitas', seedSt, () => assertFails(R(db.anon(), 'stats/own1_1').update({ views: 3 })));
  await t('NO subir dos contadores a la vez', seedSt, () => assertFails(R(db.anon(), 'stats/own1_1').update({ views: 11, saves: 3 })));
  await t('el dueño lee sus estadísticas', seedSt, () => assertSucceeds(R(db.owner('own1'), 'stats/own1_1').get()));
  await t('un cliente o otra cuenta NO las leen', seedSt, async () => { await assertFails(R(db.anon(), 'stats/own1_1').get()); await assertFails(R(db.owner('own2'), 'stats/own1_1').get()); });

  sec('7) Locales sugeridos');
  const sug = (uid) => ({ name: 'Bar X', city: 'Lorca', lat: 37.6, lng: -1.7, createdBy: uid, requests: 1, claimed: false, createdAt: ST() });
  const createSug = (uid, withVote = true, withQuota = true) => { const d = db.guest(uid), b = d.batch(); b.set(d.doc('suggestions/s1'), sug(uid)); if (withVote) b.set(d.doc('suggestions/s1/votes/' + uid), { at: ST() }); if (withQuota) b.set(d.doc('quotas/' + uid), { win: ST(), rev: 0, sug: 1, rep: 0, at: ST(), ref: 's1' }); return b.commit(); };
  await t('sugerir un local con su voto', null, () => assertSucceeds(createSug('c1')));
  await t('sugerir SIN su voto se rechaza', null, () => assertFails(createSug('c1', false)));
  await t('NO sugerir con requests 50', null, () => assertFails((() => { const d = db.guest('c1'), b = d.batch(); b.set(d.doc('suggestions/s1'), { ...sug('c1'), requests: 50 }); b.set(d.doc('suggestions/s1/votes/c1'), { at: ST() }); b.set(d.doc('quotas/c1'), { win: ST(), rev: 0, sug: 1, rep: 0, at: ST(), ref: 's1' }); return b.commit(); })()));
  await t('3.12: NO sugerir sin sumar en el contador del día', null, () => assertFails(createSug('c1', true, false)));
  await t('3.12: NO sugerir con coordenadas imposibles', null, () => assertFails((() => { const d = db.guest('c1'), b = d.batch(); b.set(d.doc('suggestions/s1'), { ...sug('c1'), lat: 999 }); b.set(d.doc('suggestions/s1/votes/c1'), { at: ST() }); b.set(d.doc('quotas/c1'), { win: ST(), rev: 0, sug: 1, rep: 0, at: ST(), ref: 's1' }); return b.commit(); })()));
  const seedSug = (extra = {}) => seed(d => d.doc('suggestions/s1').set({ name: 'Bar X', city: 'Lorca', lat: 37.6, lng: -1.7, createdBy: 'c1', requests: 1, claimed: false, createdAt: TS.now(), ...extra }));
  const vote = uid => { const d = db.guest(uid), b = d.batch(); b.update(d.doc('suggestions/s1'), { requests: 2 }); b.set(d.doc('suggestions/s1/votes/' + uid), { at: ST() }); return b.commit(); };
  await t('otra persona vota una vez', seedSug, () => assertSucceeds(vote('c2')));
  await t('la misma persona NO vota dos veces', () => seed(async d => { await d.doc('suggestions/s1').set({ name: 'Bar X', city: 'Lorca', lat: 37.6, lng: -1.7, createdBy: 'c1', requests: 2, claimed: false, createdAt: TS.now() }); await d.doc('suggestions/s1/votes/c2').set({ at: TS.now() }); }), () => assertFails(vote('c2')));
  await t('NO subir votos sin registrar el voto', seedSug, () => assertFails(R(db.guest('c2'), 'suggestions/s1').update({ requests: 2 })));
  await t('los votos no se leen', () => seed(async d => { await seedSug.call(null); }), () => assertFails(R(db.guest('c1'), 'suggestions/s1/votes/c1').get()));
  await t('quien la sugirió la borra', seedSug, () => assertSucceeds(R(db.guest('c1'), 'suggestions/s1').delete()));
  await t('otra persona NO la borra', seedSug, () => assertFails(R(db.guest('c2'), 'suggestions/s1').delete()));

  sec('8) Denuncias y reclamaciones');
  const rep = (uid, extra = {}) => ({ rid: 'own1_1', revId: 'c1', uid, byOwner: false, reason: 'spam', text: '', createdAt: ST(), status: 'pendiente', ...extra });
  await t('denunciar una opinión', seedRv, () => assertSucceeds(qset(db.guest('c2'), 'c2', 'rep', 'own1_1__c1__c2', 'reports/own1_1__c1__c2', rep('c2'))));
  await t('NO denunciar con el identificador mal formado', seedRv, () => assertFails(qset(db.guest('c2'), 'c2', 'rep', 'cualquiera', 'reports/cualquiera', rep('c2'))));
  await t('NO denunciar con un motivo inventado', seedRv, () => assertFails(qset(db.guest('c2'), 'c2', 'rep', 'own1_1__c1__c2', 'reports/own1_1__c1__c2', rep('c2', { reason: 'xx' }))));
  await t('NO denunciar como otra persona', seedRv, () => assertFails(qset(db.guest('c2'), 'c2', 'rep', 'own1_1__c1__c3', 'reports/own1_1__c1__c3', rep('c3'))));
  await t('NO denunciar una opinión que no existe', seedR, () => assertFails(qset(db.guest('c2'), 'c2', 'rep', 'own1_1__zz__c2', 'reports/own1_1__zz__c2', rep('c2', { revId: 'zz' }))));
  await t('el dueño denuncia con texto de 10+ caracteres', seedRv, () => assertSucceeds(qset(db.owner('own1'), 'own1', 'rep', 'own1_1__c1__own1', 'reports/own1_1__c1__own1', rep('own1', { byOwner: true, text: 'Esta opinión es falsa, no vino.' }))));
  await t('el dueño NO denuncia sin explicación', seedRv, () => assertFails(qset(db.owner('own1'), 'own1', 'rep', 'own1_1__c1__own1', 'reports/own1_1__c1__own1', rep('own1', { byOwner: true, text: '' }))));
  const seedRep = () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('restaurants/own1_1/reviews/c1').set(review('c1')); await d.doc('reports/own1_1__c1__c2').set({ rid: 'own1_1', revId: 'c1', uid: 'c2', byOwner: false, reason: 'spam', text: '', createdAt: TS.now(), status: 'pendiente' }); });
  await t('la administración lee las denuncias', seedRep, () => assertSucceeds(R(db.admin(), 'reports/own1_1__c1__c2').get()));
  await t('quien denunció ve la suya', seedRep, () => assertSucceeds(R(db.guest('c2'), 'reports/own1_1__c1__c2').get()));
  await t('otra persona NO ve la denuncia', seedRep, () => assertFails(R(db.guest('c3'), 'reports/own1_1__c1__c2').get()));
  await t('la administración resuelve una denuncia', seedRep, () => assertSucceeds(R(db.admin(), 'reports/own1_1__c1__c2').update({ status: 'retirada', resolvedAt: ST() })));
  await t('quien denunció NO se la resuelve a sí mismo', seedRep, () => assertFails(R(db.guest('c2'), 'reports/own1_1__c1__c2').update({ status: 'retirada', resolvedAt: ST() })));
  const clm = (uid, extra = {}) => ({ rid: 'own1_1', uid, name: 'Pepe Pérez', role: 'dueño', email: 'pepe@ejemplo.es', phone: '600123456', message: 'Es mi bar', createdAt: ST(), status: 'pendiente', ...extra });
  await t('reclamar un local ajeno', seedR, () => assertSucceeds(R(db.owner('own2'), 'claims/own1_1__own2').set(clm('own2'))));
  await t('un cliente anónimo NO reclama', seedR, () => assertFails(R(db.guest('c1'), 'claims/own1_1__c1').set(clm('c1'))));
  await t('NO reclamar tu propio local', seedR, () => assertFails(R(db.owner('own1'), 'claims/own1_1__own1').set(clm('own1'))));
  await t('NO reclamar con estado «aprobada»', seedR, () => assertFails(R(db.owner('own2'), 'claims/own1_1__own2').set(clm('own2', { status: 'aprobada' }))));
  const seedClm = () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('claims/own1_1__own2').set({ rid: 'own1_1', uid: 'own2', name: 'Pepe Pérez', role: 'dueño', email: 'p@e.es', phone: '600123456', message: '', createdAt: TS.now(), status: 'pendiente' }); });
  await t('el dueño actual NO ve la reclamación', seedClm, () => assertFails(R(db.owner('own1'), 'claims/own1_1__own2').get()));
  await t('quien reclama ve la suya', seedClm, () => assertSucceeds(R(db.owner('own2'), 'claims/own1_1__own2').get()));
  await t('quien reclama NO se aprueba a sí mismo', seedClm, () => assertFails(R(db.owner('own2'), 'claims/own1_1__own2').update({ status: 'aprobada', resolvedAt: ST() })));
  await t('la administración aprueba', seedClm, () => assertSucceeds(R(db.admin(), 'claims/own1_1__own2').update({ status: 'aprobada', resolvedAt: ST() })));
  await t('redirects: lectura pública, solo la administración escribe', null, async () => {
    await assertSucceeds(R(db.admin(), 'redirects/own1_1').set({ to: 'own2_1', at: ST() }));
    await assertFails(R(db.owner('own2'), 'redirects/own1_2').set({ to: 'own2_2', at: ST() }));
    await assertSucceeds(R(db.anon(), 'redirects/own1_1').get());
  });

  sec('9) Fichas de uso');
  const usr = { firstSeen: ST(), lastSeen: ST(), days: 1, mode: 'pwa', platform: 'android' };
  await t('mi ficha de uso', null, () => assertSucceeds(R(db.guest('c1'), 'users/c1').set(usr)));
  await t('NO la ficha de otra persona', null, () => assertFails(R(db.guest('c1'), 'users/c2').set({ ...usr })));
  await t('NO ficha con modo inventado', null, () => assertFails(R(db.guest('c1'), 'users/c1').set({ ...usr, mode: 'hack' })));
  await t('NO leer la ficha de otra persona', () => seed(d => d.doc('users/c2').set({ days: 1 })), () => assertFails(R(db.guest('c1'), 'users/c2').get()));
  await t('la administración lee fichas', () => seed(d => d.doc('users/c2').set({ days: 1 })), () => assertSucceeds(R(db.admin(), 'users/c2').get()));
  await t('NO actualizar antes de 6 horas', () => seed(d => d.doc('users/c1').set({ firstSeen: TS.now(), lastSeen: TS.now(), days: 1, mode: 'pwa', platform: 'android' })), () => assertFails(R(db.guest('c1'), 'users/c1').update({ lastSeen: ST(), days: 2 })));
  await t('actualizar pasadas 6 horas', () => seed(d => d.doc('users/c1').set({ firstSeen: TS.now(), lastSeen: TS.fromMillis(Date.now() - 7 * 3600000), days: 1, mode: 'pwa', platform: 'android' })), () => assertSucceeds(R(db.guest('c1'), 'users/c1').update({ lastSeen: ST(), days: 2 })));

  sec('12) 3.12 · Administración solo con Google y límites diarios por cuenta');
  await t('el email de administración con CONTRASEÑA NO administra', () => seed(d => d.doc('aiUsage/a').set({ x: 1 })), () => assertFails(R(db.adminWithPassword(), 'aiUsage/a').get()));
  await t('con Google sí', () => seed(d => d.doc('aiUsage/a').set({ x: 1 })), () => assertSucceeds(R(db.admin(), 'aiUsage/a').get()));
  const seedR2 = () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('restaurants/own2_1').set(rest('own2', 1)); });
  await t('NO opinar sin sumar en el contador', seedR2, () => assertFails(R(db.guest('c1'), 'restaurants/own1_1/reviews/c1').set(reviewNew('c1'))));
  await t('NO opinar con la suma apuntando a otra publicación', seedR2, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own2_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1'))));
  await t('NO dos publicaciones con una sola suma', seedR2, () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own2_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1'), [['restaurants/own2_1/reviews/c1', reviewNew('c1')]])));
  let qWin = null;
  const seedQ = (n, winMsAgo = 60000) => { qWin = TS.fromMillis(Date.now() - winMsAgo); return seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('quotas/c1').set({ win: qWin, rev: n, sug: 0, rep: 0, at: qWin, ref: 'x' }); }); };
  await t('la opinión 20 del día SÍ', () => seedQ(19), async () => { const d = db.guest('c1'), w = qWin; const b = d.batch(); b.set(d.doc('restaurants/own1_1/reviews/c1'), reviewNew('c1')); b.set(d.doc('quotas/c1'), { win: w, rev: 20, sug: 0, rep: 0, at: ST(), ref: 'own1_1/c1' }); return assertSucceeds(b.commit()); });
  await t('la opinión 21 del día NO', () => seedQ(20), async () => { const d = db.guest('c1'), w = qWin; const b = d.batch(); b.set(d.doc('restaurants/own1_1/reviews/c1'), reviewNew('c1')); b.set(d.doc('quotas/c1'), { win: w, rev: 21, sug: 0, rep: 0, at: ST(), ref: 'own1_1/c1' }); return assertFails(b.commit()); });
  await t('NO reiniciar la ventana antes de 24 horas', () => seedQ(20), () => assertFails(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1'))));
  await t('pasadas 24 horas SÍ se reinicia', () => seedQ(20, 25 * 3600000), () => assertSucceeds(qset(db.guest('c1'), 'c1', 'rev', 'own1_1/c1', 'restaurants/own1_1/reviews/c1', reviewNew('c1'))));
  await t('NO bajar el contador', () => seedQ(5), async () => { const w = qWin; return assertFails(R(db.guest('c1'), 'quotas/c1').set({ win: w, rev: 0, sug: 0, rep: 0, at: ST(), ref: 'x' })); });
  await t('NO subir de 2 en 2', () => seedQ(5), async () => { const w = qWin; return assertFails(R(db.guest('c1'), 'quotas/c1').set({ win: w, rev: 7, sug: 0, rep: 0, at: ST(), ref: 'x' })); });
  await t('NO borrar el contador con la ventana abierta', () => seedQ(20), () => assertFails(R(db.guest('c1'), 'quotas/c1').delete()));
  await t('SÍ borrarlo con la ventana cerrada', () => seedQ(20, 25 * 3600000), () => assertSucceeds(R(db.guest('c1'), 'quotas/c1').delete()));
  await t('NO tocar el contador de otra persona', () => seedQ(5), () => assertFails(R(db.guest('c2'), 'quotas/c1').set({ win: ST(), rev: 0, sug: 0, rep: 0, at: ST(), ref: 'x' })));
  await t('NO leer el contador de otra persona', () => seedQ(5), () => assertFails(R(db.guest('c2'), 'quotas/c1').get()));
  await t('NO campos extra en el contador', null, () => assertFails(R(db.guest('c1'), 'quotas/c1').set({ win: ST(), rev: 0, sug: 0, rep: 0, at: ST(), ref: 'x', vip: true })));
  await t('NO denunciar sin sumar', seedRv, () => assertFails(R(db.guest('c2'), 'reports/own1_1__c1__c2').set(rep('c2'))));
  const seedS9 = () => seed(async d => { await d.doc('restaurants/own1_1').set(rest('own1', 1)); await d.doc('suggestions/s9').set({ name: 'Bar X', city: 'Lorca', lat: 37.6, lng: -1.7, createdBy: 'c1', requests: 1, claimed: false, createdAt: TS.now() }); });
  await t('NO reclamar una sugerencia apuntándola a un local que ya existía', seedS9, () => assertFails(R(db.owner('own1'), 'suggestions/s9').update({ claimed: true, claimedBy: 'own1', claimedRid: 'own1_1' })));
  await t('NO dar de alta un local «desde una sugerencia» sin reclamarla', seedS9, () => assertFails(R(db.owner('own1'), 'restaurants/own1_2').set(restNew('own1', { fromSuggestion: 's9' }))));
  await t('alta del local + reclamar su sugerencia a la vez, SÍ', seedS9, () => { const d = db.owner('own1'), b = d.batch(); b.set(d.doc('restaurants/own1_2'), restNew('own1', { fromSuggestion: 's9' })); b.update(d.doc('suggestions/s9'), { claimed: true, claimedBy: 'own1', claimedRid: 'own1_2' }); return assertSucceeds(b.commit()); });

  sec('13) 3.12.2 · Informes de errores técnicos (clientErrors)');
  const day = new Date().toISOString().slice(0, 10);
  const eid = day + '_0123456789abcdef';
  const errDoc = (extra = {}) => ({ v: '3.12.2', ctx: 'app', msg: 'TypeError: x is undefined', src: 'app.html:10:5', plat: 'android', count: 1, day, first: ST(), last: ST(), exp: inDays(90), ...extra });
  const seedErr = (count = 1) => seed(d => d.doc('clientErrors/' + eid).set({ ...errDoc(), count, first: TS.now(), last: TS.now() }));
  await t('un informe de error SÍ, incluso sin sesión', null, () => assertSucceeds(R(db.anon(), 'clientErrors/' + eid).set(errDoc())));
  await t('NO leer los informes sin ser administración', seedErr, () => assertFails(R(db.guest('c1'), 'clientErrors/' + eid).get()));
  await t('la administración SÍ los lee', seedErr, () => assertSucceeds(R(db.admin(), 'clientErrors/' + eid).get()));
  await t('NO campos extra (por ejemplo, un email)', null, () => assertFails(R(db.anon(), 'clientErrors/' + eid).set(errDoc({ email: 'a@b.es' }))));
  await t('NO un mensaje de más de 200 caracteres', null, () => assertFails(R(db.anon(), 'clientErrors/' + eid).set(errDoc({ msg: 'x'.repeat(201) }))));
  await t('NO un identificador que no sea {día}_{resumen}', null, () => assertFails(R(db.anon(), 'clientErrors/' + day + '_cualquiercosa').set(errDoc())));
  await t('NO un día que no coincide con el identificador', null, () => assertFails(R(db.anon(), 'clientErrors/2020-01-01_0123456789abcdef').set(errDoc())));
  await t('NO empezar el contador en 50', null, () => assertFails(R(db.anon(), 'clientErrors/' + eid).set(errDoc({ count: 50 }))));
  await t('NO guardarlo más de 95 días', null, () => assertFails(R(db.anon(), 'clientErrors/' + eid).set(errDoc({ exp: inDays(400) }))));
  await t('repetido: SÍ sumar 1', seedErr, () => assertSucceeds(R(db.anon(), 'clientErrors/' + eid).update({ count: FV.increment(1), last: ST() })));
  await t('NO sumar 5 de golpe', seedErr, () => assertFails(R(db.anon(), 'clientErrors/' + eid).update({ count: FV.increment(5), last: ST() })));
  await t('NO cambiar el mensaje de un informe', seedErr, () => assertFails(R(db.anon(), 'clientErrors/' + eid).update({ count: FV.increment(1), last: ST(), msg: 'otro' })));
  await t('NO pasar del tope de 10.000 repeticiones', () => seedErr(10000), () => assertFails(R(db.anon(), 'clientErrors/' + eid).update({ count: FV.increment(1), last: ST() })));
  await t('NO borrarlos sin ser administración', seedErr, () => assertFails(R(db.guest('c1'), 'clientErrors/' + eid).delete()));

  await env.cleanup();
  console.log(`\n==== ${pass} correctas, ${fail} fallos ====`);
  if (fail) { console.log('Fallos:\n - ' + failed.join('\n - ')); process.exit(1); }
})().catch(e => { console.error('ERROR GRAVE', e); process.exit(2); });

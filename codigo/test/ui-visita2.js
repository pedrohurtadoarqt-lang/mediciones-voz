// Nota de audio por estancias: cocina, siguiente estancia (baño), volver a grabar el baño y procesar con apartados por estancia
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1000);
  await pg.evaluate(() => {
    const real = window.Cloud; let k = 0; window.__proc = '';
    const textos = ['Mide cuatro por tres y dos setenta de alto. Quitar el alicatado y alicatar de nuevo.', 'Dos por uno ochenta, plato de ducha e inodoro.', 'Dos por uno noventa, plato de ducha, inodoro y lavabo.'];
    const Z = (z) => Object.assign({ ref: '', ambito: 'interior', nombre: '', borrar: false, largo: null, ancho: null, superficie: null, perimetro: null, tramos: [], altura: null, huecos_modo: '', huecos: [], cub_tipo: '', remonte: null, pendiente: null, faldones: [], prof_min: null, prof_max: null, fon_tipo: '', agua_fria: null, agua_fria_caliente: null, inodoro: '', ducha: '', mampara: '', bide: '', lavadora: '', lavavajillas: '', cuadro: '', puntos_luz: null, tomas: null, segun_norma: '', horno: '', equipos: [] }, z);
    window.Cloud = new Proxy(real, { get: (t, key) => key === 'user' ? { id: 'u', email: 'x@y' } : key === 'visita' ? async (body) => {
      await new Promise((r) => setTimeout(r, 150));
      if (body.modo === 'transcribir') return { texto: textos[Math.min(k++, 2)] };
      window.__proc = body.transcripcion;
      return { result: { zonas: [Z({ nombre: 'Cocina', largo: 4, ancho: 3, altura: 2.7 }), Z({ nombre: 'Baño', largo: 2, ancho: 1.9 })], trabajos: [{ id: 'dem_alic', codigo: '', buscar: '', unidad: '', ambito: '', zonas: ['Cocina'], quitar: false, medidas: [] }, { id: 'rev_alic', codigo: '', buscar: '', unidad: '', ambito: '', zonas: ['Cocina'], quitar: false, medidas: [] }], contenedores: null, seguridad_pct: null, accion: '', mensaje: '', pregunta: null, opciones: [] } };
    } : t[key] });
  });
  await pg.click('text=Nueva obra'); await pg.fill('#ftit', 'Visita por estancias'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  await pg.click('#btnGrabar'); await pg.waitForTimeout(300);
  await pg.click('[data-a="vnueva"][data-nom="Cocina"]'); await pg.waitForTimeout(2000);
  await pg.screenshot({ path: 'test/v2_grabando.png' });
  await pg.click('[data-a="vsig"]'); await pg.waitForTimeout(600);
  await pg.fill('#vnom', 'baño'); await pg.click('.row >> [data-a="vnueva"]'); await pg.waitForTimeout(2000);
  await pg.click('[data-a="vparar"]'); await pg.waitForTimeout(1500);
  await pg.click('[data-a="vregrabar"] >> nth=1'); await pg.waitForTimeout(2000);
  await pg.click('[data-a="vparar"]'); await pg.waitForTimeout(1500);
  await pg.screenshot({ path: 'test/v2_notas.png', fullPage: true });
  console.log('Notas:', await pg.$$eval('.vnota b', (x) => x.map((e) => e.textContent)));
  await pg.click('[data-a="vprocesar"]'); await pg.waitForTimeout(1200);
  console.log('Enviado a procesar:\n' + await pg.evaluate(() => window.__proc));
  console.log('Pregunta:', (await pg.textContent('#talk')).slice(-160));
  console.log('ERRORES', errs); await b.close();
})();

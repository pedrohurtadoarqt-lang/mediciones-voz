// Nota de audio de la visita: grabar (micro simulado), transcribir y procesar (IA simulada), y preguntas de lo que falta
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1000);
  await pg.evaluate(() => {
    const real = window.Cloud;
    const Z = (z) => Object.assign({ ref: '', ambito: 'interior', nombre: '', borrar: false, largo: null, ancho: null, superficie: null, perimetro: null, tramos: [], altura: null, huecos_modo: '', huecos: [], cub_tipo: '', remonte: null, pendiente: null, faldones: [], prof_min: null, prof_max: null, fon_tipo: '', agua_fria: null, agua_fria_caliente: null, inodoro: '', ducha: '', mampara: '', bide: '', lavadora: '', lavavajillas: '', cuadro: '', puntos_luz: null, tomas: null, segun_norma: '', horno: '' }, z);
    const T = (t) => Object.assign({ id: '', codigo: '', buscar: '', unidad: '', ambito: '', zonas: [], quitar: false, medidas: [] }, t);
    window.__llamadas = [];
    window.Cloud = new Proxy(real, { get: (t, k) => k === 'user' ? { id: 'u', email: 'x@y' } : k === 'visita' ? async (body) => {
      window.__llamadas.push(body.modo + (body.audio ? ' ' + body.mime + ' (' + body.audio.length + ' b64)' : ''));
      await new Promise((r) => setTimeout(r, 200));
      if (body.modo === 'transcribir' && !/wav/.test(body.mime)) throw new Error('Unsupported MIME type');
      if (body.modo === 'transcribir') return { texto: 'Técnico: Empezamos por la cocina, mide cuatro por tres y tiene dos setenta de alto. Hay que quitar el alicatado y el suelo, y alicatar de nuevo.\nOtra persona: ¿Y la puerta?\nTécnico: Sí, la puerta de 80 se cambia.\n\nTécnico: Ahora el baño, dos por uno ochenta. Plato de ducha, inodoro y lavabo.' };
      if (body.correccion) return { result: { zonas: [Z({ ref: 'z1', nombre: 'Cocina', largo: 3.2, ancho: 3 })], trabajos: [T({ id: 'dem_gres', zonas: ['Cocina'], quitar: true }), T({ id: 'pin_tec', zonas: ['Cocina'] })], contenedores: null, seguridad_pct: null, accion: '', mensaje: '', pregunta: null, opciones: [] } };
      return { result: { zonas: [Z({ nombre: 'Cocina', largo: 4, ancho: 3, altura: 2.7, huecos_modo: 'anadir', huecos: [{ tipo: 'puerta', uds: 1, ancho: 0.8, alto: null }] }), Z({ nombre: 'Baño', largo: 2, ancho: 1.8 }), Z({ ambito: 'fontaneria', nombre: 'Baño', fon_tipo: 'bano', inodoro: 'normal', ducha: 'plato' })],
        trabajos: [T({ id: 'dem_alic', zonas: ['Cocina'] }), T({ id: 'dem_gres', zonas: ['Cocina'] }), T({ id: 'rev_alic', zonas: ['Cocina'] }), T({ id: 'car_puertas', zonas: ['Cocina'] })], contenedores: null, seguridad_pct: null, accion: '', mensaje: '', pregunta: null, opciones: [] } };
    } : t[k] });
  });
  await pg.click('[data-a="newobra"]'); await pg.fill('#ftit', 'Visita grabada'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  await pg.click('#btnGrabar'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: 'test/v_inicio.png' });
  await pg.click('[data-a="vmodo"][data-m="continua"]'); await pg.waitForTimeout(200);
  await pg.click('[data-a="vgrabar"]'); await pg.waitForTimeout(3500);
  await pg.screenshot({ path: 'test/v_grabando.png' });
  await pg.click('[data-a="vparar"]'); await pg.waitForTimeout(1500);
  await pg.screenshot({ path: 'test/v_revision.png', fullPage: true });
  console.log('llamadas:', JSON.stringify(await pg.evaluate(() => window.__llamadas)));
  await pg.click('[data-a="vprocesar"]'); await pg.waitForTimeout(1200);
  console.log('Pregunta:', (await pg.textContent('#talk')).slice(-230));
  console.log('Partidas:', await pg.$$eval('.pitem', (x) => x.length));
  await pg.screenshot({ path: 'test/v_obra.png' });
  // Nota de corrección
  await pg.click('#btnGrabar'); await pg.waitForTimeout(300);
  await pg.click('[data-a="vcorr"]'); await pg.waitForTimeout(2500);
  await pg.click('[data-a="vparar"]'); await pg.waitForTimeout(1500);
  await pg.fill('#ctxt', 'Quita la demolición del suelo de la cocina, la cocina mide 3,20 por 3 y añade pintar el techo.');
  await pg.screenshot({ path: 'test/v_corr.png', fullPage: true });
  await pg.click('[data-a="vcorrapl"]'); await pg.waitForTimeout(1200);
  console.log('Tras corregir:', (await pg.textContent('#talk')).slice(-220));
  console.log('Partidas tras corregir:', await pg.$$eval('.pitem', (x) => x.map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 60)).filter((t) => /Demolición de pavimento|Pintura|Cocina/.test(t))));
  console.log('ERRORES', errs); await b.close();
})();

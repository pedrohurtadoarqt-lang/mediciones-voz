// Modo conversación en el navegador con cuenta e IA simuladas: pantalla de la obra con las mediciones en vivo
const { chromium } = require('playwright');
const C = require('./c1.js');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1200);
  await pg.evaluate((guion) => {
    const ZV = { ref: '', ambito: 'interior', nombre: '', borrar: false, largo: null, ancho: null, superficie: null, perimetro: null, tramos: [], altura: null, huecos_modo: '', huecos: [], cub_tipo: '', remonte: null, pendiente: null, faldones: [], prof_min: null, prof_max: null, fon_tipo: '', agua_fria: null, agua_fria_caliente: null, inodoro: '', ducha: '', mampara: '', bide: '', lavadora: '', lavavajillas: '', cuadro: '', puntos_luz: null, tomas: null, segun_norma: '', horno: '' };
    const TV = { id: '', codigo: '', buscar: '', unidad: '', ambito: '', zonas: [], quitar: false, medidas: [] };
    const mapa = new Map(guion.map(([f, r]) => [f, r]));
    const real = window.Cloud;
    window.__ctx = [];
    window.Cloud = new Proxy(real, { get: (t, k) => k === 'user' ? { id: 'u1', email: 'prueba@local' } : k === 'available' ? () => true : k === 'conversa' ? async (ctx) => { window.__ctx.push(ctx); await new Promise((r) => setTimeout(r, 150)); const r = mapa.get(ctx.frase) || {}; return { result: Object.assign({ zonas: [], trabajos: [], contenedores: null, seguridad_pct: null, accion: '', mensaje: '', pregunta: null, opciones: [] }, r, { zonas: (r.zonas || []).map((z) => Object.assign({}, ZV, z)), trabajos: (r.trabajos || []).map((x) => Object.assign({}, TV, x)) }) }; } : t[k] });
  }, C);
  await pg.click('[data-a="newobra"]'); await pg.fill('#ftit', 'Reforma piso Conversación'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  console.log('Saludo:', (await pg.textContent('#talk')).slice(-200));
  const say = async (t) => { if (await pg.isHidden('#typebar')) await pg.click('#btnKeyboard'); await pg.fill('#typein', t); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(450); };
  for (const [f] of C.slice(0, 7)) await say(f);
  await pg.screenshot({ path: 'test/c_obra.png' });
  for (const [f] of C.slice(7, 11)) await say(f);
  console.log('Final:', (await pg.textContent('#talk')).slice(-260));
  await pg.click('#btnDock'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: 'test/c_fin.png', fullPage: false });
  console.log('Contexto enviado (último):', JSON.stringify(await pg.evaluate(() => { const c = window.__ctx[window.__ctx.length - 1]; return { zonas: c.zonas.length, trabajos: c.trabajos.length, faltan: c.faltan, historial: c.historial.length, candidatas: c.candidatas.length }; })));
  console.log('ERRORES', errs); await b.close();
})();

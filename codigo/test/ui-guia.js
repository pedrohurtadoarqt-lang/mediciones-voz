// Prueba de interfaz del asistente guiado (escribiendo en lugar de hablar)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1500);
  await pg.click('[data-a="newobra"]'); await pg.fill('#ftit', 'Reforma piso Sindicat'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  const say = async (t) => { if (await pg.isHidden('#typebar')) await pg.click('#btnKeyboard'); await pg.fill('#typein', t); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(250); };
  await pg.click('.chip >> nth=0'); await pg.waitForTimeout(200);
  for (const t of ['salón', '4,20 metros derecha, 3,50 derecha, 4,20 derecha, 3,50 derecha', '2,60', 'una puerta de 0,82 por 2,03 y una ventana de 1,20 por 1,10', 'ninguna más', 'baño', '2 por 1,80', 'la misma', 'una puerta de 0,72 por 2,03', 'no']) await say(t);
  await pg.screenshot({ path: 'test/g_toma.png' });
  for (const t of ['elegir trabajos', 'correcto', 'no', 'no']) await say(t); await pg.waitForTimeout(300);
  for (const t of ['Demolición de alicatado', 'Solado de gres porcelánico', 'Pintura plástica en paredes', 'Pintura plástica en techos', 'Alicatado']) await pg.click('.tw-main:has-text("' + t + '")');
  await pg.click('.tw.on:has-text("Alicatado") >> .tw-z .chip >> text=Salón').catch(() => {});
  await pg.fill('#tq', 'falso techo registrable'); await pg.waitForTimeout(200); await pg.click('#tres button >> nth=0'); await pg.waitForTimeout(200);
  await pg.evaluate(() => document.querySelector('main').scrollTo(0, 0)); await pg.screenshot({ path: 'test/g_trabajos.png' }); await pg.evaluate(() => document.querySelector('main').scrollTo(0, 99999)); await pg.screenshot({ path: 'test/g_trabajos2.png' });
  await pg.click('text=Generar mediciones'); await pg.waitForTimeout(400);
  await pg.screenshot({ path: 'test/g_fin.png' });
  await pg.click('#btnMenu'); await pg.click('text=Resumen de la obra'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: 'test/g_resumen.png', fullPage: true });
  const dl = pg.waitForEvent('download'); await pg.click('#btnMenu'); await pg.click('text=Exportar PDF de mediciones'); const d = await dl; await d.saveAs('test/g_out.pdf');
  console.log('ERRORES', errs); await b.close();
})();

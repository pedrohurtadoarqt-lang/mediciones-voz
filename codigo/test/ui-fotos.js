// Fotos de referencia (miniatura, visor, PDF) y capítulos desplegables en el resumen
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.setDefaultTimeout(6000); const paso = (t) => console.log('· ' + t);
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1000);
  await pg.click('[data-a="newobra"]'); await pg.fill('#ftit', 'Fotos y capítulos'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  const say = async (t) => { if (await pg.isHidden('#typebar')) await pg.click('#btnKeyboard'); await pg.fill('#typein', t); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(250); };
  for (const t of ['estancia', 'baño', '2 por 1,8', '2,40', 'ninguna', 'elegir trabajos', 'correcto', 'no', 'no']) await say(t);
  for (const t of ['Demolición de alicatado', 'Alicatado', 'Solado de gres porcelánico']) await pg.click('.tw-main:has-text("' + t + '")').catch(() => {});
  paso('trabajos'); await pg.click('text=Generar mediciones'); await pg.waitForTimeout(500); paso('generado');
  await pg.setInputFiles('.toma-z .fotoin', process.env.FOTO); await pg.waitForTimeout(800);
  console.log('miniaturas en la zona:', await pg.$$eval('.toma-z ~ .fotos .foto img, .fotos .foto img', (x) => x.length));
  await pg.click('.fotos .foto >> nth=0'); await pg.waitForTimeout(400);
  console.log('visor abierto:', !!(await pg.$('.visor img')));
  await pg.screenshot({ path: 'test/f_visor.png' });
  await pg.click('.visor [data-v="cerrar"]');
  await pg.click('#btnMenu'); await pg.click('.menu-list >> text=Resumen de la obra'); await pg.waitForTimeout(300);
  console.log('capítulos:', await pg.$$eval('details.capdesp', (x) => x.map((d) => d.querySelector('.t').textContent + (d.open ? ' (abierto)' : ' (cerrado)'))));
  await pg.click('details.capdesp >> nth=0 >> summary'); await pg.waitForTimeout(200);
  await pg.screenshot({ path: 'test/f_resumen.png' });
  // foto en una partida y PDF
  await pg.click('details.capdesp[open] .pitem >> nth=0'); await pg.waitForTimeout(300);
  const pf = await pg.$('.monitor .fotoin'); if (pf) { await pf.setInputFiles(process.env.FOTO); await pg.waitForTimeout(800); }
  await pg.screenshot({ path: 'test/f_partida.png' });
  console.log('foto en partida:', await pg.$$eval('.fotobloque .foto img', (x) => x.length));
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }).catch(() => null), pg.evaluate(() => { const b = document.querySelector('[data-a="pdf"]'); if (b) b.click(); })]);
  if (!dl) { await pg.click('#btnMenu'); const [d2] = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }), pg.click('.menu-list >> text=Exportar PDF')]); await d2.saveAs('test/f_out.pdf'); } else await dl.saveAs('test/f_out.pdf');
  console.log('ERRORES', errs); await b.close();
})();

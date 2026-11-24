const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1500);
  await pg.click('[data-a="newobra"]'); await pg.fill('#ftit', 'Prueba export'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  const say = async (t) => { if (await pg.isHidden('#typebar')) await pg.click('#btnKeyboard'); await pg.fill('#typein', t); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(250); };
  for (const t of ['vivienda', 'salón', '4 por 3', '2,60', 'una puerta de 0,82 por 2,03', 'ninguna más', 'elegir trabajos', 'correcto', 'no', 'no']) await say(t);
  await pg.click('.tw-main:has-text("Solado de gres")'); await pg.click('text=Generar mediciones'); await pg.waitForTimeout(500);
  for (const k of ['Exportar Excel', 'Exportar BC3']) {
    await pg.click('#btnMenu'); await pg.click('text=Resumen de la obra'); await pg.waitForTimeout(200);
    const dl = pg.waitForEvent('download', { timeout: 5000 }).catch((e) => null);
    await pg.click('text=' + k); const d = await dl; await pg.waitForTimeout(400);
    console.log(k, d ? 'descarga ' + d.suggestedFilename() : 'SIN DESCARGA', '| toast:', await pg.textContent('#toast').catch(() => ''));
  }
  console.log('ERRORES', errs); await b.close();
})();

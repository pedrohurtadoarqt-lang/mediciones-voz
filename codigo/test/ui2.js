const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1200);
  await pg.click('text=Abrir'); await pg.waitForTimeout(400);
  await pg.screenshot({ path: 'test/s_ej.png' });
  // muchas líneas
  await pg.evaluate(() => { const a = window.MedicionesApp; const p = a.dialog.active(); for (let i = 0; i < 70; i++) p.lineas.push({ id: 100 + i, est: 'Dormitorio ' + (i % 4 + 1), com: 'Paño ' + i, uds: 1, l: 2 + i / 10, a: null, h: 2.5 }); });
  const dl = pg.waitForEvent('download'); await pg.evaluate(() => window.MedicionesApp.exportPdf(window.MedicionesApp.S.obra)); const d = await dl; await d.saveAs('test/out2.pdf');
  // importar BC3
  await pg.click('#btnMenu'); await pg.click('text=Bases de datos BC3');
  await pg.setInputFiles('#bc3file', 'data/Palma48_2026_COAATMCA.bc3'); await pg.waitForTimeout(2500);
  await pg.fill('#catq', 'toma de corriente'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: 'test/s_cat.png' });
  console.log('ERRORS', errs); await b.close();
})();

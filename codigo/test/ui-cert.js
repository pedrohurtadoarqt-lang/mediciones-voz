// Inicio (Medición / Certificación), nueva medición «Medir» → nota de audio, y certificación desde un BC3 con sus salidas
// node test/ui-cert.js dist/pwa/index.html presupuesto.bc3
const { chromium } = require('playwright'), path = require('path');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + path.resolve(process.argv[2])); await pg.waitForTimeout(1200);
  const sc = (n) => pg.screenshot({ path: path.join(__dirname, n + '.png') });
  await sc('k_inicio');
  // Medición → Medir
  await pg.click('[data-a="newobra"]'); await pg.click('[data-a="nmodo"][data-m="medir"]'); await pg.fill('#ftit', 'Piso medir'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(500);
  console.log('Medir → vista:', await pg.evaluate(() => document.querySelector('#title, header h1, .title') ? document.body.innerText.slice(0, 80).replace(/\n/g, ' | ') : ''));
  await pg.click('#btnBack'); await pg.waitForTimeout(300); if (await pg.$('#btnBack:not([hidden])')) { await pg.click('#btnBack'); await pg.waitForTimeout(300); }
  // Certificación
  await pg.click('[data-a="inicio-cert"]'); await pg.setInputFiles('#cfile', path.resolve(process.argv[3])); await pg.fill('#fcli', 'Cliente X'); await pg.click('#cgo'); await pg.waitForTimeout(800);
  await sc('k_cert');
  await pg.click('.capdesp >> nth=0 >> summary'); await pg.click('[data-a="cpart"] >> nth=0'); await pg.waitForTimeout(200);
  await pg.click('[data-a="cpct"][data-v="100"]'); await pg.waitForTimeout(200);
  await pg.click('[data-a="csig"]'); await pg.waitForTimeout(200);
  await pg.click('[data-a="clinea-add"]'); await pg.waitForTimeout(100);
  await pg.fill('.cline input[data-c="com"]', 'Cocina'); await pg.fill('.cline input[data-c="l"]', '6'); await pg.fill('.cline input[data-c="a"]', '2,7');
  await sc('k_partida');
  await pg.click('[data-a="cguardar"]'); await pg.waitForTimeout(300);
  console.log('Totales:', (await pg.textContent('.certnums')).replace(/\s+/g, ' '));
  await pg.click('[data-a="cnueva"]'); await pg.click('text=Nueva certificación >> nth=-1'); await pg.waitForTimeout(300);
  console.log('Tras nueva:', (await pg.textContent('.certtot h3')), (await pg.textContent('.certnums')).replace(/\s+/g, ' '));
  for (const k of ['pdf', 'xlsx', 'bc3']) {
    const [d] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }).catch(() => null), pg.click('[data-a="cexp"][data-k="' + k + '"]')]);
    if (d) { const f = path.join(__dirname, 'k_out.' + k); await d.saveAs(f); console.log('Descarga', k, d.suggestedFilename(), require('fs').statSync(f).size, 'bytes'); } else console.log('Sin descarga', k);
    await pg.waitForTimeout(300);
  }
  await sc('k_cert2');
  await pg.click('#btnBack'); await pg.waitForTimeout(300); await sc('k_inicio2');
  console.log('Lista:', (await pg.textContent('.obralist')).replace(/\s+/g, ' '));
  console.log('Errores:', errs.length ? errs : 'ninguno');
  await b.close();
})();

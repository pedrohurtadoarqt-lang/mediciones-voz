// Empresa: logo y datos en Ajustes → cabecera del PDF; registro con dirección y NIF validado; trabajos generales
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1500);
  await pg.click('#btnMenu'); await pg.click('.menu-list >> text=Ajustes'); await pg.waitForTimeout(200);
  await pg.setInputFiles('#logofile', process.env.LOGO); await pg.waitForTimeout(500);
  await pg.fill('#enom', 'Construcciones Ejemplo SL'); await pg.fill('#enif', 'B12345675'); await pg.click('#femp button[type=submit]'); await pg.waitForTimeout(200);
  console.log('NIF malo →', await pg.textContent('#toast'));
  await pg.fill('#enif', 'B12345674'); await pg.fill('#edir', 'C/ Mayor 1, Palma'); await pg.fill('#etel', '971 000 000'); await pg.click('#femp button[type=submit]'); await pg.waitForTimeout(300);
  await pg.evaluate(() => document.querySelector('.logo-box').scrollIntoView()); await pg.screenshot({ path: 'test/e_ajustes.png' });
  await pg.click('#btnBack'); await pg.waitForTimeout(200);
  await pg.click('[data-a="newobra"]'); await pg.fill('#ftit', 'Reforma con logo'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  const say = async (t) => { if (await pg.isHidden('#typebar')) await pg.click('#btnKeyboard'); await pg.fill('#typein', t); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(250); };
  for (const t of ['estancia', 'baño 2 por 2', '2,5', 'ninguna', 'elegir trabajos', 'no']) await say(t);
  console.log('generales:', await pg.$$eval('.tw.on .tw-t', (x) => x.map((e) => e.firstChild.textContent.trim())));
  await pg.click('.tw-main:has-text("Demolición de alicatado")'); await pg.click('text=Generar mediciones'); await pg.waitForTimeout(400);
  console.log('pregunta:', (await pg.textContent('.talk')).slice(-200));
  await say('así está bien');
  const dl = pg.waitForEvent('download'); await pg.click('#btnMenu'); await pg.click('text=Exportar PDF de mediciones'); const d = await dl; await d.saveAs('test/e_out.pdf');
  await pg.click('#btnMenu'); await pg.click('.menu-list >> text=/Entrar|Crear cuenta|cuenta/').catch(() => {}); await pg.waitForTimeout(200); await pg.click('[data-a=signup]').catch(() => {}); await pg.waitForTimeout(200);
  console.log('registro:', await pg.$$eval('#facc label', (x) => x.map((e) => e.textContent.trim()).filter((t) => t && t !== 'No rellenar')));
  console.log('ERRORES', errs); await b.close();
})();

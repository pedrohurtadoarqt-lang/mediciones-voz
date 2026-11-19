// Compartir archivos: simula la hoja de compartir del móvil y comprueba los archivos que recibe
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await pg.addInitScript(() => { window.__comp = []; navigator.canShare = (d) => !!(d && d.files); navigator.share = async (d) => { window.__comp.push(d.files.map((f) => f.name + ' (' + f.type + ', ' + f.size + ' B)')); }; });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1500);
  await pg.click('text=Nueva obra'); await pg.fill('#ftit', 'Compartir'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  const say = async (t) => { if (await pg.isHidden('#typebar')) await pg.click('#btnKeyboard'); await pg.fill('#typein', t); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(250); };
  for (const t of ['vivienda', 'salón 4 por 3', '2,60', 'ninguna', 'elegir trabajos', 'no']) await say(t);
  await pg.click('.tw-main:has-text("Pintura plástica en paredes")'); await pg.click('text=Generar mediciones'); await pg.waitForTimeout(400);
  await pg.click('.chip:has-text("Compartir archivos")'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: 'test/g_share.png' });
  await pg.click('.sharek[value="xlsx"]'); await pg.click('.sharek[value="bc3"]'); await pg.click('#sharego'); await pg.waitForTimeout(500);
  console.log('compartido:', JSON.stringify(await pg.evaluate(() => window.__comp)));
  await pg.click('#btnMenu'); console.log('menú:', (await pg.textContent('.menu-list')).includes('Compartir archivos'));
  console.log('ERRORES', errs); await b.close();
})();

// Corregir una estancia a mano desde la pantalla (botón ✎ de la toma de datos)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/dist/mediciones-voz.html'); await pg.waitForTimeout(1000);
  await pg.click('text=Nueva obra'); await pg.fill('#ftit', 'Edición de zona'); await pg.click('text=Crear y empezar'); await pg.waitForTimeout(400);
  const say = async (t) => { if (await pg.isHidden('#typebar')) await pg.click('#btnKeyboard'); await pg.fill('#typein', t); await pg.press('#typein', 'Enter'); await pg.waitForTimeout(250); };
  for (const t of ['estancia', 'dormitorio', '4 por 3', '2,60', 'una puerta de 0,82 por 2,03', 'ninguna más']) await say(t);
  await pg.click('[data-a="zedit"]'); await pg.waitForTimeout(200);
  await pg.fill('#zm', '2 derecha, 1 izquierda, 1 derecha, 2 derecha, 3 derecha, 3'); await pg.fill('#za', '2,50'); await pg.fill('#zh', 'una puerta de 0,80 por 2 y una ventana de 1,20 por 1,20');
  await pg.click('#fzona button[type=submit]'); await pg.waitForTimeout(300);
  console.log('Zona:', (await pg.textContent('.toma-z')).replace(/\s+/g, ' ').slice(0, 200));
  console.log('ERRORES', errs); await b.close();
})();

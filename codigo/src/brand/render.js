const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(__dirname + '/logo.svg', 'utf8');
  const b = await chromium.launch(); const pg = await b.newPage();
  const shot = async (size, out, pad, bg) => {
    await pg.setViewportSize({ width: size, height: size });
    const inner = pad ? `<div style="width:${size}px;height:${size}px;background:${bg};display:grid;place-items:center"><div style="width:${size*0.8}px;height:${size*0.8}px">${svg.replace('rx="112"','rx="0"')}</div></div>` : svg;
    await pg.setContent(`<html><body style="margin:0;background:transparent">${inner.replace('<svg ', `<svg width="${pad ? size*0.8 : size}" height="${pad ? size*0.8 : size}" `)}</body></html>`);
    await pg.screenshot({ path: __dirname + '/' + out, omitBackground: !pad });
  };
  await shot(512, 'icon-512.png'); await shot(192, 'icon-192.png');
  await shot(512, 'icon-maskable-512.png', true, '#1F2839');
  await shot(180, 'apple-touch-icon.png', true, '#1F2839');
  await b.close();
})();

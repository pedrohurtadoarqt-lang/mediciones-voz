// Genera dist/mediciones-voz.html (archivo único autocontenido) y dist/artifact.html (cuerpo para publicar).
const fs = require('fs'), path = require('path');
const BC3 = require('./src/bc3.js');
const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const bc3File = process.argv[2] || path.join(__dirname, 'data', 'Palma48_2026_COAATMCA.bc3');
const cat = BC3.parseBC3(fs.readFileSync(bc3File), 'Base de partidas Mediciona');
// Partidas que faltaban en la base y que usa el asistente guiado (se añaden si el código no existe)
const extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'partidas-extra.json'), 'utf8'));
const codigos = new Set(cat.partidas.map((p) => p.c));
extra.forEach((p) => { if (!codigos.has(p.c) && cat.capitulos[p.ch]) cat.partidas.push({ c: p.c, u: p.u, r: p.r, t: p.t, ch: p.ch }); });
cat.nombre = 'Base de partidas Mediciona'; cat.titulo = 'Base de partidas Mediciona';
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const fontB64 = (n) => fs.readFileSync(path.join(__dirname, 'src', 'fonts', 'LiberationSans-' + n + '.ttf')).toString('base64');
const fontJs = 'window.PDF_FONTS={regular:"' + fontB64('Regular') + '",bold:"' + fontB64('Bold') + '",italic:"' + fontB64('Italic') + '"};';
const catJs = 'window.CATALOGO_BASE=' + JSON.stringify(cat).replace(/<\//g, '<\\/') + ';';
// Montserrat alojada en la propia app (sin Google Fonts: privacidad y uso sin conexión)
const woff = (w) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(__dirname, 'src', 'fonts', 'montserrat-latin-' + w + '-normal.woff2')).toString('base64');
const fontFace = [700, 800].map((w) => "@font-face{font-family:'Montserrat';font-style:normal;font-weight:" + w + ";font-display:swap;src:url(" + woff(w) + ") format('woff2');}").join('\n') + '\n';
const head = '<title>Mediciona</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<meta name="theme-color" content="#1A2231">\n<meta name="description" content="Mediciona: mediciones de obra con IA">\n<style>\n' + fontFace + src('styles.css') + '</style>\n';
const scripts = ['<script>' + safe(src('vendor-jspdf.umd.min.js')) + '</script>', '<script>' + catJs + '</script>', '<script>' + fontJs + '</script>', '<script>' + safe(src('bc3.js')) + '</script>', '<script>' + safe(src('engine.js')) + '</script>', '<script>' + safe(src('guia.js')) + '</script>', '<script>' + safe(src('conversa.js')) + '</script>', '<script>' + safe(src('export.js')) + '</script>', '<script>' + safe(src('certificacion.js')) + '</script>', '<script>' + safe(src('ai.js')) + '</script>', '<script>' + safe(src('vendor-supabase.umd.js')) + '</script>', '<script>' + safe(src('cloud-config.js')) + '</script>', '<script>' + safe(src('cloud.js')) + '</script>', '<script>window.FRASES_VOZ = ' + safe(JSON.stringify(require('./frases-voz.js')())) + ';</script>', '<script>' + safe(src('app.js')) + '</script>'].join('\n');
const iconData = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'src', 'brand', 'icon-192.png')).toString('base64');
const body = src('body.html').replace('src="icon-192.png"', 'src="' + iconData + '"');
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'mediciones-voz.html'), '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + head + '</head>\n<body>\n' + body + scripts + '\n</body>\n</html>\n');
fs.writeFileSync(path.join(__dirname, 'dist', 'artifact.html'), head + body + scripts + '\n');
console.log('Partidas:', cat.partidas.length, '| tamaño:', (fs.statSync(path.join(__dirname, 'dist', 'mediciones-voz.html')).size / 1e6).toFixed(2), 'MB');

// Versión PWA (para GitHub Pages / cualquier hosting https): instalable y offline.
const pwa = path.join(__dirname, 'dist', 'pwa');
fs.rmSync(pwa, { recursive: true, force: true });
fs.mkdirSync(pwa, { recursive: true });
const pwaHead = '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon-192.png" type="image/png">\n<link rel="apple-touch-icon" href="apple-touch-icon.png">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Mediciona">\n<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n';
const swReg = '<script>if ("serviceWorker" in navigator && location.protocol === "https:") { var hadSW = !!navigator.serviceWorker.controller; navigator.serviceWorker.register("sw.js").then(function (r) { setInterval(function () { r.update(); }, 30 * 60 * 1000); document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") r.update(); }); }).catch(function () {}); navigator.serviceWorker.addEventListener("controllerchange", function () { if (hadSW && window.MedicionaUpdate) window.MedicionaUpdate(); hadSW = true; }); }</script>';
fs.writeFileSync(path.join(pwa, 'index.html'), '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + pwaHead + head + '</head>\n<body>\n' + src('body.html') + scripts + '\n' + swReg + '\n</body>\n</html>\n');
const ver = Date.now().toString(36);
fs.writeFileSync(path.join(pwa, 'sw.js'), "const C='mediciona-" + ver + "';\nself.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'])).then(()=>self.skipWaiting()));});\nself.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});\nself.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));});\n");
fs.writeFileSync(path.join(pwa, 'manifest.webmanifest'), JSON.stringify({ name: 'Mediciona · Mediciones de obra con IA', short_name: 'Mediciona', description: 'Mediciones de obra por voz con IA: partidas BC3, PDF, Excel y BC3.', id: './', start_url: './', scope: './', display: 'standalone', orientation: 'portrait', background_color: '#1A2231', theme_color: '#1A2231', lang: 'es', categories: ['business', 'productivity', 'utilities'], icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }, null, 2));
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) fs.copyFileSync(path.join(__dirname, 'src', 'brand', f), path.join(pwa, f));
fs.copyFileSync(path.join(__dirname, 'src', 'brand', 'logo.svg'), path.join(pwa, 'logo.svg'));
// Lector de PDF (se carga solo al leer un presupuesto en PDF)
fs.mkdirSync(path.join(pwa, 'vendor'), { recursive: true });
for (const f of ['pdf.min.js', 'pdf.worker.min.js']) fs.copyFileSync(path.join(__dirname, 'src', 'vendor-pdfjs', f), path.join(pwa, 'vendor', f));
fs.mkdirSync(path.join(pwa, 'legal'), { recursive: true });
for (const f of fs.readdirSync(path.join(__dirname, 'src', 'legal'))) fs.copyFileSync(path.join(__dirname, 'src', 'legal', f), path.join(pwa, 'legal', f));
console.log('PWA en dist/pwa');

// La función de IA del servidor usa el mismo núcleo que la app
fs.copyFileSync(path.join(__dirname, 'src', 'ai.js'), path.join(__dirname, 'supabase', 'functions', 'ai-interpret', 'ai-core.js'));

// Servidor (función ai-interpret): instrucciones del modo conversación y catálogo de trabajos de la app
{
  global.self = global; global.Engine = require('./src/engine.js');
  const G = require('./src/guia.js');
  const fdir = path.join(__dirname, 'supabase', 'functions', 'ai-interpret');
  fs.copyFileSync(path.join(__dirname, 'src', 'conversa-ai.js'), path.join(fdir, 'conversa-core.js'));
  const lista = G.TRABAJOS.filter((w) => w.ambito !== 'obra').map((w) => ({ id: w.id, ambito: w.ambito, label: w.label, u: w.u, regla: G.REGLA_LABEL[w.regla] || '' }));
  fs.writeFileSync(path.join(fdir, 'trabajos.js'), '// Generado por build.js desde src/guia.js\nglobalThis.MEDICIONA_TRABAJOS = ' + JSON.stringify(lista) + ';\n');
  console.log('Servidor: ' + lista.length + ' trabajos en el catálogo del modo conversación');
}

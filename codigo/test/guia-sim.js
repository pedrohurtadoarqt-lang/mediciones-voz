// Simulación del asistente guiado: node test/guia-sim.js test/g1.txt  (BC3=ruta)
// Líneas del guion: texto dictado · "#chip N" pulsa un chip · "#marca id1,id2" marca trabajos en pantalla · "#genera"
const B = require('../src/bc3.js'), E = require('../src/engine.js'), G = require('../src/guia.js'), fs = require('fs');
const base = B.parseBC3(fs.readFileSync(process.env.BC3), 'Palma');
const ya = new Set(base.partidas.map((p) => p.c));
JSON.parse(fs.readFileSync(__dirname + '/../src/partidas-extra.json', 'utf8')).forEach((p) => { if (!ya.has(p.c)) base.partidas.push(p); });
const cat = E.prepareCatalog(base);
const out = [];
var io;
io = { say: (t, ch) => out.push('  APP: ' + t + (ch && ch.length ? '\n       [' + ch.map((c) => c.label).join(' | ') + ']' : '')), user: (t) => out.push('USER: ' + t), save() {}, render() {}, getCatalog: () => cat, exportPdf() {}, sketch: (svg, t) => out.push('  [croquis ' + t + ']'), trabajos: (on) => out.push('  [pantalla trabajos ' + (on ? 'abierta' : 'cerrada') + ']'), note: (t) => out.push('  NOTA: ' + t) };
// IA simulada: GUIA_IA='{"texto":"..."}' responde con una orden
if (process.env.GUIA_IA) io.agent = async () => ({ acciones: [{ tipo: 'orden', texto: JSON.parse(process.env.GUIA_IA).texto }], mensaje: '', pregunta: null, opciones: [] });
if (process.env.GUIA_IA) io.aiReady = () => true;
if (process.env.BREVE) { io.breve = () => true; io.setBreve = () => {}; }
const d = new E.Dialog(io);
const obra = { id: 't', titulo: 'Prueba', partidas: [], estancias: [] };
d.setObra(obra);
(async () => {
for (const l of fs.readFileSync(process.argv[2], 'utf8').split('\n').filter((x) => x && !x.startsWith('//'))) {
  if (l.startsWith('#chip ')) d.handle(d.lastPrompt.chips[+l.slice(6)]);
  else if (l.startsWith('#marca ')) { const sel = G.seleccion(obra); l.slice(7).split(',').forEach((id) => { if (sel[id]) sel[id].on = true; else out.push('  !! trabajo no ofrecido: ' + id); }); out.push('  [marcados: ' + l.slice(7) + ']'); }
  else if (l === '#genera') d.guia.generarMediciones();
  else d.handle(l);
  await new Promise((r) => setTimeout(r, 5));
}
console.log(out.join('\n'));
console.log('\n=== TOMA ===\n' + JSON.stringify(obra.toma.zonas.map((z) => Object.assign({}, z, { tramos: undefined, planta: undefined }))));
console.log('\n=== MEDICIONES ===');
for (const c of E.obraChapters(obra)) { console.log(c.codigo, c.titulo); for (const p of c.partidas) { console.log(' ', p.codigo, p.ref, E.unitLabel(p.u), p.r, '=', E.totalOf(p)); for (const ln of p.lineas) console.log('     ', ln.est, '|', ln.com, '|', ln.uds, ln.l, ln.a, ln.h, '=', E.parcial(ln)); } }
})();

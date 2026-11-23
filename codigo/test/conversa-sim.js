// Simulación del modo conversación con una IA de respuestas fijas: node test/conversa-sim.js test/c1.js  (BC3=ruta)
// El guion es un módulo que exporta [[frase, respuestaIA], ...]; las respuestas pueden ser parciales (se completan con vacíos).
const B = require('../src/bc3.js'), E = require('../src/engine.js'), G = require('../src/guia.js'), fs = require('fs');
const base = B.parseBC3(fs.readFileSync(process.env.BC3), 'Palma');
const ya = new Set(base.partidas.map((p) => p.c));
JSON.parse(fs.readFileSync(__dirname + '/../src/partidas-extra.json', 'utf8')).forEach((p) => { if (!ya.has(p.c)) base.partidas.push(p); });
const cat = E.prepareCatalog(base);
const ZV = { ref: '', ambito: 'interior', nombre: '', borrar: false, largo: null, ancho: null, superficie: null, perimetro: null, tramos: [], altura: null, huecos_modo: '', huecos: [], cub_tipo: '', remonte: null, pendiente: null, faldones: [], prof_min: null, prof_max: null, fon_tipo: '', agua_fria: null, agua_fria_caliente: null, inodoro: '', ducha: '', mampara: '', bide: '', lavadora: '', lavavajillas: '', cuadro: '', puntos_luz: null, tomas: null, segun_norma: '', horno: '' };
const TV = { id: '', codigo: '', buscar: '', unidad: '', ambito: '', zonas: [], quitar: false, medidas: [] };
const completa = (r) => Object.assign({ zonas: [], trabajos: [], contenedores: null, seguridad_pct: null, accion: '', mensaje: '', pregunta: null, opciones: [] }, r, {
  zonas: (r.zonas || []).map((z) => Object.assign({}, ZV, z)), trabajos: (r.trabajos || []).map((t) => Object.assign({}, TV, t))
});
const guion = require(require('path').resolve(process.argv[2]));
const out = []; const log = []; let i = 0; const ctxs = [];
const io = {
  say: (t, ch, o) => { log.push({ who: 'app', text: t }); if (process.env.VOZ && o && o.voz && o.voz !== t) out.push('  VOZ: ' + o.voz); out.push('  APP: ' + t + (ch && ch.length ? '\n       [' + ch.map((c) => c.label).join(' | ') + ']' : '')); },
  user: (t) => { log.push({ who: 'user', text: t }); out.push('USER: ' + t); }, note() {}, save() {}, render() {}, getCatalog: () => cat, exportPdf() {}, sketch() {}, trabajos() {},
  aiReady: () => true, historial: () => log.slice(-10),
  conversa: async (ctx) => { ctxs.push(ctx); const r = guion[i - 1] && guion[i - 1][1]; return { result: completa(r || {}) }; }
};
const d = new E.Dialog(io);
const obra = { id: 't', titulo: 'Prueba', partidas: [], estancias: [] };
d.setObra(obra);
(async () => {
  if (guion.visita) { // nota de audio: se aplica la respuesta completa de una vez
    const r = d.conversa.aplicarVisita(completa(guion.respuesta), guion.transcripcion);
    d.conversa.siguiente('Procesada: ' + r.zonas + ' zonas, ' + r.trabajos + ' trabajos, ' + r.partidas + ' partidas.');
  }
  for (const [frase] of (guion.visita ? [] : guion)) { i++; d.handle(frase); await new Promise((r) => setTimeout(r, 5)); }
  console.log(out.join('\n'));
  if (process.env.CTX) console.log('\n=== ÚLTIMO CONTEXTO ===\n' + require('../src/conversa-ai.js').buildConvUser(ctxs[ctxs.length - 1]));
  console.log('\n=== TOMA ===\n' + obra.toma.zonas.map((z) => z.id + ' ' + z.ambito + ' ' + z.nombre + ' · ' + d.conversa.datosZona(z)).join('\n'));
  console.log('\n=== MEDICIONES ===');
  for (const c of E.obraChapters(obra)) { console.log(c.codigo, c.titulo); for (const p of c.partidas) { console.log(' ', p.codigo, p.ref, E.unitLabel(p.u), p.r, '=', E.totalOf(p)); for (const ln of p.lineas) console.log('     ', ln.est, '|', ln.com, '|', ln.uds, ln.l, ln.a, ln.h, ln.hPend ? '(falta altura)' : ''); } }
})();

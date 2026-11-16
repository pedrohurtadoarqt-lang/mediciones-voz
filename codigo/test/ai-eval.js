// Evaluación de la IA de respaldo con frases difíciles. Uso: node test/ai-eval.js <modelo> [n]
const B = require('../src/bc3.js'), E = require('../src/engine.js'), fs = require('fs');
global.Engine = E; const AI = require('../src/ai.js');
const cat = E.prepareCatalog(B.parseBC3(fs.readFileSync(process.env.BC3 || 'data/Palma48_2026_COAATMCA.bc3')));
const model = process.argv[2] || 'gemini-flash-lite-latest';
// [frase, intent esperado, códigos aceptables (o null), contexto opcional]
const CASES = [
  ['demolición de pavimento de madera', 'partida', ['DRS040', 'DRS050']],
  ['quitar el parquet del salón', 'partida', ['DRS050', 'DRS040']],
  ['eliminar papel pintado', 'crear_partida', null],
  ['rascar el gotelé de las paredes', 'crear_partida', null],
  ['quitar moqueta', 'crear_partida', null],
  ['picar el yeso de las paredes', 'partida', ['DRF020b']],
  ['levantar el suelo de terrazo', 'partida', ['DRS010b']],
  ['tirar el tabique de ladrillo del baño', 'partida', ['DPT020b', 'DPT020c']],
  ['quitar el plato de ducha', 'partida', ['DSM010b']],
  ['poner un plato de ducha de resina de 90', 'partida', ['SAD025b']],
  ['alicatar las paredes de la cocina con azulejo liso', 'partida', ['RAG012']],
  ['pintar el techo con plástica', 'partida', ['RIP030', 'RIP030a']],
  ['falso techo de pladur', 'partida', ['RTA020d', 'RTC015c']],
  ['hacer rozas en el ladrillo para la luz', 'partida', ['HYO010e', 'HYO010d']],
  ['quitar el rodapié de madera', 'partida', ['DRS041']],
  ['desmontar el váter', 'partida', ['DSM010c']],
  ['picado de a su lejos', 'partida', ['DRA010']],
  ['solera de mortero de cinco centímetros', 'partida', ['RSB010', 'RSB016']],
  ['quitar los radiadores', 'partida', ['DIC010']],
  ['pared de la ventana tres cuarenta por dos sesenta y descuenta la ventana uno veinte por uno diez', 'medida', null, { activa: 'RIP030' }],
  ['dos paredes de cuatro veinte y otras dos de tres diez', 'medida', null, { activa: 'RIP030' }],
  ['vale ya está nos vamos al salón', 'estancia', null],
  ['esa no es la que quiero', 'comando', null, { activa: 'DEM020b' }],
  ['el techo mide lo mismo que el suelo', 'comando', null, { activa: 'RIP030' }]
];
(async () => {
  const n = +(process.argv[3] || CASES.length);
  let ok = 0, tin = 0, tout = 0, ms = 0;
  for (const [frase, intent, codes, extra] of CASES.slice(0, n)) {
    const act = extra && extra.activa ? (() => { const d = cat.byCode.get(extra.activa); return { ref: d.c, r: d.r, u: d.u }; })() : null;
    const ctx = { frase, motivo: 'el motor no está seguro', estancia: 'Salón', activa: act, candidatas: AI.candidates(cat, frase), historial: [] };
    const inCands = codes ? codes.some((c) => ctx.candidatas.some((d) => d.c === c)) : true;
    const t0 = Date.now();
    let r;
    try {
      r = await AI.interpret(ctx, { send: async (c) => {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer proxy-injected' }, body: JSON.stringify(AI.requestBody(c, model)) });
        const j = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(j).slice(0, 300));
        return { result: j.choices[0].message.content, usage: j.usage };
      } });
    } catch (e) { console.log('ERROR', frase, e.message); continue; }
    ms += Date.now() - t0; tin += (r.usage && r.usage.prompt_tokens) || 0; tout += (r.usage && r.usage.completion_tokens) || 0;
    const good = r.intent === intent && (!codes || codes.includes(r.partida_codigo));
    if (good) ok++;
    console.log((good ? 'OK ' : 'MAL') + ' | ' + frase + ' → ' + r.intent + ' ' + (r.partida_codigo ? r.partida_codigo + ' ' + (cat.byCode.get(r.partida_codigo) || {}).r : '') + (r.nueva_descripcion ? ' [' + r.nueva_descripcion + ', ' + r.nueva_unidad + ']' : '') + (r.texto_normalizado ? ' «' + r.texto_normalizado + '»' : '') + (r.estancia ? ' {' + r.estancia + '}' : '') + ' c=' + r.confianza + (inCands ? '' : ' (correcta NO estaba en candidatas)') + ' ' + (Date.now() - t0) + 'ms');
  }
  console.log('\n' + model + ': ' + ok + '/' + n + ' aciertos · media ' + Math.round(ms / n) + ' ms · tokens medios entrada ' + Math.round(tin / n) + ' salida ' + Math.round(tout / n));
})();

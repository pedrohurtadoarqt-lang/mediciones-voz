/* ============================================================
 * IA DE RESPALDO (independiente del proveedor)
 *  - Solo se usa cuando el motor determinista no está seguro.
 *  - Recibe lo dictado + contexto + partidas candidatas de la base.
 *  - Devuelve una interpretación estructurada (JSON) que el motor
 *    vuelve a validar: nunca puede inventar códigos de partida.
 * El transporte (servidor propio / proxy) lo aporta quien llama:
 *   AI.interpret(ctx, { send: async (body) => respuestaJSON })
 * ============================================================ */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  const SYSTEM = [
    'Eres el intérprete de Mediciona, una app de mediciones de obra que se usa por voz en España.',
    'Recibes una frase dictada en obra (transcrita automáticamente, puede tener errores de reconocimiento), el contexto de la medición y una lista de partidas candidatas de la base de datos BC3.',
    'Tu trabajo es decidir qué quiso decir el usuario y responder SOLO con el JSON pedido.',
    'Reglas:',
    '1. Si pide un trabajo, elige la partida de la lista que corresponda. Usa exclusivamente códigos de la lista; nunca inventes ni modifiques un código.',
    '2. Distingue demolición/retirada (quitar, picar, levantar, eliminar, arrancar, desmontar, rascar) de obra nueva (colocar, poner, hacer, alicatar, solar, pintar). Nunca propongas una partida de obra nueva para un trabajo de demolición ni al revés.',
    '3. Tiene que coincidir el elemento y el material: "pavimento de madera" o "parquet" no es "forjado de viguetas de madera"; "moqueta" no es "solado cerámico".',
    '4. Si ninguna candidata corresponde de verdad, usa intent "crear_partida" y propón una descripción breve y profesional (estilo de base de precios, en español) y su unidad (ud, m, m2, m3).',
    '5. Si la frase son medidas (números, "por", "con"), usa intent "medida" y escríbelas en "texto_normalizado" en el formato que entiende la app: "comentario 3,40 por 2,50", "descuenta puerta de 0,82 por 2,03", "2 de 1,20 por 1,40", "la altura es 2,60" (una medida por línea si hay varias, separadas por " | ").',
    '6. Si cambia de estancia, intent "estancia" y en "estancia" el nombre (Baño 1, Cocina, Dormitorio 2...).',
    '7. Si es una orden, intent "comando" y en "texto_normalizado" la orden con estas palabras exactas: "siguiente partida", "terminar", "deshacer", "lee las líneas", "borra la última línea", "cambia la partida", "para", "siguiente estancia", "aplica las mismas medidas que en el <partida o elemento>" (cuando dice que algo mide lo mismo que otra cosa ya medida, p. ej. el techo igual que el suelo), "mismas medidas" (igual que la partida anterior de esta estancia).',
    '8. Si no se entiende nada, intent "no_entiendo" y en "pregunta" una pregunta breve para aclararlo.',
    '9. "confianza" entre 0 y 1. Usa menos de 0.6 si dudas entre varias partidas, y pon las otras en "alternativas" (máximo 3 códigos de la lista).',
    '10. Los números hablados: "tres con cuarenta" = 3,40; "dos cincuenta" = 2,50; "cero ochenta y dos" = 0,82.',
    '11. Si hay una partida activa y el usuario habla de la forma de la sala o de cómo medir ("no es rectangular", "tiene forma de L", "son dos partes"), NO es un trabajo nuevo: si da medidas, descompón en rectángulos con intent "medida" ("parte 1 4 por 3 | parte 2 2 por 1,5", o "superficie 18,5" si da el total); si no da medidas, intent "comando" con texto_normalizado "no es rectangular".',
    '12. Con una partida activa, una frase corta solo es un trabajo nuevo si nombra claramente otro trabajo (otro elemento, material u operación).'
  ].join('\n');

  const SCHEMA = {
    type: 'object',
    properties: {
      intent: { type: 'string', enum: ['partida', 'crear_partida', 'medida', 'estancia', 'comando', 'no_entiendo'] },
      partida_codigo: { type: ['string', 'null'] },
      alternativas: { type: 'array', items: { type: 'string' } },
      confianza: { type: 'number' },
      nueva_descripcion: { type: ['string', 'null'] },
      nueva_unidad: { type: ['string', 'null'], enum: ['ud', 'm', 'm2', 'm3', null] },
      texto_normalizado: { type: ['string', 'null'] },
      estancia: { type: ['string', 'null'] },
      pregunta: { type: ['string', 'null'] }
    },
    required: ['intent', 'partida_codigo', 'alternativas', 'confianza', 'nueva_descripcion', 'nueva_unidad', 'texto_normalizado', 'estancia', 'pregunta'],
    additionalProperties: false
  };

  /** Candidatas con buena cobertura: las mejores por puntuación + las mejores por cada palabra clave. */
  function candidates(cat, text, extra) {
    const idx = cat.index;
    const seen = new Map();
    const add = (r) => { if (r && !seen.has(r.doc.c)) seen.set(r.doc.c, r.doc); };
    idx.search(text).slice(0, 30).forEach(add);
    E.words(text).filter((w) => w.length > 3).forEach((w) => idx.search(w).slice(0, 12).forEach(add));
    (extra || []).forEach((q) => idx.search(q).slice(0, 10).forEach(add));
    return [...seen.values()].slice(0, 70);
  }

  function buildUser(ctx) {
    const c = ctx.candidatas.map((d) => d.c + ' | ' + E.unitLabel(d.u) + ' | ' + d.r + ' | ' + (d.path || d.chapTitle || '')).join('\n');
    return [
      'FRASE DICTADA: «' + ctx.frase + '»',
      'MOTIVO DE LA CONSULTA: ' + (ctx.motivo || 'el motor no lo ha entendido'),
      'ESTANCIA ACTIVA: ' + (ctx.estancia || '(ninguna)'),
      'PARTIDA ACTIVA: ' + (ctx.activa ? ctx.activa.ref + ' · ' + ctx.activa.r + ' (' + E.unitLabel(ctx.activa.u) + ')' : '(ninguna)'),
      ctx.rechazadas && ctx.rechazadas.length ? 'PARTIDAS QUE EL USUARIO YA HA RECHAZADO (no las propongas): ' + ctx.rechazadas.join(', ') : '',
      ctx.historial && ctx.historial.length ? 'ÚLTIMOS MENSAJES:\n' + ctx.historial.slice(-6).map((m) => (m.who === 'user' ? 'Usuario: ' : 'App: ') + m.text).join('\n') : '',
      'PARTIDAS CANDIDATAS (código | unidad | resumen | capítulo):\n' + c
    ].filter(Boolean).join('\n\n');
  }

  /** Cuerpo de la petición en formato OpenAI-compatible (Gemini, Claude vía proxy, etc.). */
  function requestBody(ctx, model) {
    return {
      model,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: buildUser(ctx) }],
      response_format: { type: 'json_schema', json_schema: { name: 'interpretacion', strict: true, schema: SCHEMA } },
      temperature: 0
    };
  }

  /** Valida la respuesta contra las candidatas: lo que no sea de la lista se descarta. */
  function validate(out, ctx) {
    const codes = new Set(ctx.candidatas.map((d) => d.c));
    const rej = new Set(ctx.rechazadas || []);
    const r = Object.assign({ alternativas: [] }, out || {});
    if (r.partida_codigo && (!codes.has(r.partida_codigo) || rej.has(r.partida_codigo))) {
      r.partida_codigo = null;
      if (r.intent === 'partida') r.intent = r.nueva_descripcion ? 'crear_partida' : 'no_entiendo';
    }
    r.alternativas = (r.alternativas || []).filter((c) => codes.has(c) && !rej.has(c) && c !== r.partida_codigo).slice(0, 3);
    if (r.nueva_unidad && !['ud', 'm', 'm2', 'm3'].includes(r.nueva_unidad)) r.nueva_unidad = null;
    if (typeof r.confianza !== 'number') r.confianza = 0.5;
    return r;
  }

  async function interpret(ctx, transport) {
    const t0 = Date.now();
    const raw = await transport.send(ctx);
    let out = raw && raw.result ? raw.result : raw;
    if (typeof out === 'string') { try { out = JSON.parse(out); } catch (e) { out = null; } }
    const r = validate(out, ctx);
    r.ms = Date.now() - t0;
    r.usage = raw && raw.usage;
    return r;
  }

  const api = { SYSTEM, SCHEMA, candidates, buildUser, requestBody, validate, interpret };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AI = api;
})(typeof self !== 'undefined' ? self : this);

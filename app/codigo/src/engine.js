/* ============================================================
 * MOTOR DETERMINISTA (sin APIs externas)
 *  - Normalización de texto y números dictados en español
 *  - Índice de búsqueda difusa sobre el catálogo BC3
 *  - Indexación semántica de atributos (medios, espesor, material…)
 *  - Embudo de discriminación de partidas
 *  - Inteligencia dimensional por unidad
 *  - Gestor de diálogo (máquina de estados)
 * No toca el DOM: se comunica con la UI mediante `io`.
 * ============================================================ */
(function (root) {
  'use strict';

  /* ---------------- Utilidades de texto ---------------- */
  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[²]/g, '2').replace(/[³]/g, '3');
  }
  function words(s) {
    return norm(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  }
  function stem(w) {
    if (/^\d/.test(w)) return w;
    if (w.length > 4 && /[^aeiou]es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
    if (w.length > 4 && /[aoe]$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  const STOP = new Set(('de del la las el los en con por para y a al un una unos unas que se su sus o e lo le ' +
    'mas sin hay hacer hacemos poner ponemos pon quiero vamos metemos mete ahora tambien medir medimos medicion ' +
    'nueva nuevo otra otro partida trabajo trabajos esto este esta eso ese tipo me te nos alli aqui todo toda').split(' '));

  function lev1(a, b) {
    // true si distancia de Levenshtein <= 1
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, e = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++e > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return e + (la - i) + (lb - j) <= 1;
  }
  function contentWords(t) { return words(t).filter((w) => !STOP.has(w) && !FILLER.has(w) && !/^\d/.test(w) && !(w in NUMW)); }
  function cap(s) { s = (s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function titleCase(s) { return (s || '').split(/\s+/).filter(Boolean).map((w, i) => (i > 0 && /^(de|del|la|el|y)$/.test(w)) ? w : cap(w)).join(' '); }

  const fmt = (n, d = 2) => (n === null || n === undefined || isNaN(n)) ? '' :
    Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true });
  const fmtUds = (n) => (n === null || n === undefined) ? '' : (Number.isInteger(n) ? String(n) : fmt(n));
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  const UNIT_LABEL = { ud: 'ud', m: 'm', m2: 'm²', m3: 'm³', kg: 'kg', t: 't', l: 'l' };
  const UNIT_SPOKEN = { ud: 'unidades', m: 'metros', m2: 'metros cuadrados', m3: 'metros cúbicos', kg: 'kilos', t: 'toneladas', l: 'litros' };
  const unitLabel = (u) => UNIT_LABEL[u] || u;
  const unitSpoken = (u) => UNIT_SPOKEN[u] || u;

  /* ---------------- Números dictados ---------------- */
  const NUMW = {
    cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
    dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22,
    veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28,
    veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80,
    noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
    cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900
  };
  const ORD = { primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5, sexta: 6, sexto: 6, ultima: -1, ultimo: -1 };

  /** Tokeniza un dictado en NUM y WORD, resolviendo "3 con 40", "tres metros cuarenta", "40 cm"… */
  function tokenize(text) {
    let s = (text || '').toLowerCase()
      .replace(/(\d)\s*[x×*]\s*(\d)/g, '$1 por $2')
      .replace(/(\d)([a-záéíóúñ²³])/g, '$1 $2')
      .replace(/([a-záéíóúñ])(\d)/g, '$1 $2');
    const raw = s.match(/-?\d+(?:[.,']\d+)?|[a-záéíóúüñ²³]+/g) || [];
    // 1) palabras numéricas → números
    const t1 = [];
    for (let i = 0; i < raw.length; i++) {
      const w = raw[i], nw = norm(w);
      if (/^-?\d/.test(w)) {
        const str = w.replace(/^-/, '');
        const v = parseFloat(w.replace(/[,']/g, '.'));
        t1.push({ k: 'N', v, str, dec: /[.,']/.test(w), orig: w });
        continue;
      }
      if (nw in NUMW && !(nw === 'una' || nw === 'un') || ((nw === 'un' || nw === 'una' || nw === 'uno'))) {
        // agrupar "treinta y cinco", "ciento veinte"
        let v = NUMW[nw], str = String(v), j = i;
        if (nw === 'cero') str = '0';
        while (j + 1 < raw.length) {
          const n1 = norm(raw[j + 1]);
          if (n1 === 'y' && j + 2 < raw.length && norm(raw[j + 2]) in NUMW && v % 10 === 0 && v >= 30 && v < 100 && NUMW[norm(raw[j + 2])] < 10) {
            v += NUMW[norm(raw[j + 2])]; j += 2; str = String(v); continue;
          }
          if (n1 in NUMW && v >= 100 && v % 100 === 0 && NUMW[n1] < 100 && n1 !== 'un' && n1 !== 'una') { v += NUMW[n1]; j++; str = String(v); continue; }
          if (n1 in NUMW && nw === 'cero' && j === i && NUMW[n1] < 10) { str = '0' + NUMW[n1]; v = NUMW[n1]; j++; continue; }
          break;
        }
        t1.push({ k: 'N', v, str, dec: false, orig: raw.slice(i, j + 1).join(' '), word: true, art: (nw === 'un' || nw === 'una') && j === i });
        i = j;
        continue;
      }
      t1.push({ k: 'W', w, n: nw });
    }
    // 2) decimales hablados y unidades de longitud
    const t2 = [];
    for (let i = 0; i < t1.length; i++) {
      const a = t1[i];
      if (a.k === 'N' && !a.dec) {
        const b = t1[i + 1], c = t1[i + 2];
        // "dos cincuenta" / "3 40" → 2,50 / 3,40 (metros y centímetros seguidos)
        if (b && b.k === 'N' && !b.dec && !b.art && a.v < 30 && b.v >= 10 && b.v < 100 && !(c && c.k === 'W' && /^(de|unidades|uds|tramos|veces)$/.test(c.n))) {
          t2.push({ k: 'N', v: a.v + b.v / 100, dec: true, orig: a.orig + ' ' + b.orig }); i += 1; continue;
        }
        if (b && b.k === 'W' && /^(con|coma|punto)$/.test(b.n) && c && c.k === 'N' && !c.dec) {
          t2.push({ k: 'N', v: a.v + c.v / Math.pow(10, c.str.length), dec: true, orig: a.orig + ' ' + b.w + ' ' + c.orig }); i += 2; continue;
        }
        if (b && b.k === 'W' && /^(metros?|m)$/.test(b.n) && c && c.k === 'N' && !c.dec && c.v < 100 && !(t1[i + 3] && t1[i + 3].k === 'W' && /^(metros?|m|centimetros?|cm)$/.test(t1[i + 3].n)) && !(t1[i + 3] && t1[i + 3].k === 'W' && t1[i + 3].n === 'de')) {
          t2.push({ k: 'N', v: a.v + c.v / Math.pow(10, c.str.length), dec: true, orig: a.orig + ' m ' + c.orig }); i += 2; continue;
        }
      }
      if (a.k === 'N') {
        const b = t1[i + 1];
        if (b && b.k === 'W' && /^(centimetros?|cm|cms)$/.test(b.n)) { t2.push({ k: 'N', v: a.v / 100, dec: true, orig: a.orig + ' cm' }); i++; continue; }
        if (b && b.k === 'W' && /^(milimetros?|mm)$/.test(b.n)) { t2.push({ k: 'N', v: a.v / 1000, dec: true, orig: a.orig + ' mm' }); i++; continue; }
      }
      t2.push(a);
    }
    return t2;
  }

  /** Extrae un número simple de un texto ("3 con 40" → 3.4). */
  function parseNumber(text) {
    const t = tokenize(text).filter((x) => x.k === 'N');
    return t.length ? t[0].v : null;
  }
  function parseIndex(text) {
    const n = norm(text).trim();
    for (const k in ORD) if (new RegExp('\\b' + k + '\\b').test(n)) return ORD[k];
    const v = parseNumber(text);
    return v === null ? null : Math.round(v);
  }

  const FILLER = new Set(('por de del la las el los y metros metro m cm mide miden medida medidas otra otro mas linea anota apunta ' +
    'pon anade añade con coma un una x a que en al tiene largo ancho alto altura longitud anchura espesor canto unidades uds ud ' +
    'unidad tramos tramo veces iguales descuenta descontar descuento deduce deducir deduccion resta restar menos quita quitar es son ' +
    'vale bien ok mas y tambien hay punto de mide').split(' '));
  const DEDUC = /^(descuenta|descontar|descuento|deduce|deducir|deduccion|deducimos|resta|restar|restamos|menos|descontamos|quita|quitamos)$/;
  const NWORDS = /^(unidades|unidad|uds|ud|veces|tramos|tramo|iguales|piezas|puntos)$/;

  /**
   * Analiza un dictado de medición.
   * Devuelve { n (uds explícitas o null), dims:[...], labeled:{l,a,h}, ded, comment, nums }
   */
  function parseMeasure(text) {
    const tk = tokenize(text);
    const res = { n: null, dims: [], labeled: {}, ded: false, comment: '', count: 0, orientHint: null };
    let pendingLabel = null;
    const commentW = [];
    let nIdx = -1;
    // ¿Primer número es N? (entero seguido de "de" o de palabra de unidades antes del siguiente número)
    const firstN = tk.findIndex((x) => x.k === 'N');
    if (firstN >= 0 && Number.isInteger(tk[firstN].v) && !tk[firstN].dec) {
      for (let j = firstN + 1; j < tk.length && j <= firstN + 4; j++) {
        if (tk[j].k === 'N') break;
        if (tk[j].n === 'de' && tk.slice(j + 1).some((x) => x.k === 'N')) { nIdx = firstN; break; }
        if (NWORDS.test(tk[j].n)) { nIdx = firstN; break; }
      }
      // "una puerta" sin "de": artículo, no N
    }
    for (let i = 0; i < tk.length; i++) {
      const x = tk[i];
      if (x.k === 'W') {
        if (DEDUC.test(x.n)) { res.ded = true; continue; }
        if (/^(largo|longitud)$/.test(x.n)) { pendingLabel = 'l'; continue; }
        if (/^(ancho|anchura)$/.test(x.n)) { pendingLabel = 'a'; continue; }
        if (/^(alto|altura|espesor|canto|profundidad|fondo)$/.test(x.n)) { pendingLabel = 'h'; continue; }
        if (/^(techo|techos|suelo|suelos)$/.test(x.n)) res.orientHint = 'H';
        if (/^(pared|paredes|paramento|paramentos|frente|lateral)$/.test(x.n)) res.orientHint = 'V';
        if (!FILLER.has(x.n)) commentW.push(x.w);
        continue;
      }
      // número
      if (i === nIdx) { res.n = x.v; continue; }
      if (x.art && tk[i + 1] && tk[i + 1].k === 'W' && !FILLER.has(tk[i + 1].n)) { // "una puerta…"
        if (res.n === null && tk.slice(i + 1).some((y) => y.k === 'N')) res.n = 1;
        continue;
      }
      if (pendingLabel) { res.labeled[pendingLabel] = x.v; pendingLabel = null; res.count++; continue; }
      res.dims.push(x.v); res.count++;
    }
    res.comment = cap(commentW.join(' '));
    return res;
  }

  /* ---------------- Atributos semánticos ---------------- */
  const MATERIALES = [
    ['placa de yeso laminado', /yeso laminado|pladur/], ['escayola', /escayola/], ['yeso', /\byeso\b/],
    ['hormigón', /hormigon/], ['ladrillo', /ladrillo/], ['bloque', /\bbloque/], ['piedra natural', /piedra natural|marmol|granito|caliza|arenisca/],
    ['gres porcelánico', /porcelanico/], ['gres', /\bgres\b/], ['azulejo', /azulejo/], ['cerámico', /ceramic/], ['terrazo', /terrazo/],
    ['madera', /madera|pino|roble|haya|tarima|parquet/], ['aluminio', /aluminio/], ['PVC', /\bpvc\b/], ['acero', /acero|metalic/],
    ['vidrio', /vidrio|cristal/], ['cobre', /\bcobre\b/], ['polietileno', /polietileno|multicapa|pex\b/], ['mortero', /mortero/],
    ['fibrocemento', /fibrocemento/], ['teja', /\bteja/], ['corcho', /corcho/], ['lana mineral', /lana mineral|lana de roca|lana de vidrio/],
    ['poliestireno', /poliestireno|xps|eps\b/], ['arcilla', /arcilla/], ['cal', /\bcal\b/]
  ];
  const ATTRS = [
    { id: 'capitulo', p: 0.9, q: () => '¿De qué capítulo es?', from: (d) => d.chapTitle },
    { id: 'sub', p: 1.0, q: () => '¿De qué tipo es?', from: (d) => d.subTitle },
    { id: 'medios', p: 1.3, q: () => '¿Con medios manuales o mecánicos?', vals: [['manuales', /medios manuales|manualmente|\ba mano\b|medios manual/], ['mecánicos', /martillo neumatico|medios mecanicos|retroexcavadora|miniexcavadora|compresor|pala cargadora|minicargadora|maquina|mecanic/]] },
    { id: 'recup', p: 0.9, q: () => '¿Con recuperación del material o sin recuperación?', vals: [['sin recuperación', /sin recuperacion/], ['con recuperación', /recuperacion|recuperar/]] },
    { id: 'carga', p: 0.7, q: () => '¿Con carga manual, mecánica o sin carga?', vals: [['carga manual', /carga manual/], ['carga mecánica', /carga mecanica/]] },
    { id: 'ambiente', p: 1.0, q: () => '¿Interior o exterior?', src: 'r', vals: [['interior', /\binterior/], ['exterior', /\bexterior/]] },
    { id: 'orient', p: 1.0, q: () => '¿En paramento vertical u horizontal?', src: 'r', vals: [['vertical', /vertical|pared|paramento/], ['horizontal', /horizontal|techo|cielo/]] },
    { id: 'material', p: 1.15, q: (o) => '¿De qué material? ' + o.slice(0, 4).join(', ') + '.', fn: (d) => { for (const [lab, re] of MATERIALES) if (re.test(d.nr)) return lab; for (const [lab, re] of MATERIALES) if (re.test(d.nt.slice(0, 260))) return lab; return null; } },
    { id: 'espesor', p: 1.1, q: (o) => '¿Qué espesor? ' + o.slice(0, 4).join(', ') + '.', fn: (d) => { const m = d.nr.match(/(\d+(?:[.,]\d+)?)\s*(cm|mm)\s+de espesor|espesor(?: total)?(?: de| nominal)?\s+(\d+(?:[.,]\d+)?)\s*(cm|mm)|\bde\s+(\d+(?:[.,]\d+)?)\s*cm\b(?!\s+de (ancho|alto|largo|diametro))/) || d.nt.match(/(\d+(?:[.,]\d+)?)\s*(cm|mm)\s+de espesor|espesor(?: total)?(?: de| nominal)?\s+(\d+(?:[.,]\d+)?)\s*(cm|mm)/); if (!m) return null; const v = m[1] || m[3] || m[5]; const u = m[2] || m[4] || 'cm'; return v.replace('.', ',') + ' ' + u; } },
    { id: 'formato', p: 0.9, q: (o) => '¿Qué formato? ' + o.slice(0, 4).join(', ') + '.', fn: (d) => { const m = d.nr.match(/(\(?\d+(?:[.,]\d+)?(?:\+\d+)?\)?\s*x\s*\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?)\s*(cm|mm)?/); return m ? m[1].replace(/\s+/g, '') + ' ' + (m[2] || 'cm') : null; } },
    { id: 'diametro', p: 0.9, q: (o) => '¿Qué diámetro? ' + o.slice(0, 4).join(', ') + '.', fn: (d) => { const m = (d.nr + ' ' + d.nt.slice(0, 300)).match(/(?:diametro|dn|o)\s*(?:nominal\s*|exterior\s*)?(\d+(?:[.,]\d+)?)\s*mm/); return m ? m[1] + ' mm' : null; } },
    { id: 'acabado', p: 0.8, q: (o) => '¿Qué acabado? ' + o.slice(0, 4).join(', ') + '.', fn: (d) => { const m = (d.nr + ' ' + d.nt).match(/acabado\s+(mate|satinado|brillante|brillo|liso|pulido|rugoso|natural|apomazado|abujardado|flameado|apomazado|rayado|fratasado|a buena vista|maestreado)/) || d.nr.match(/\b(mate|satinado|brillante|a buena vista|maestreado|pulido)\b/); return m ? m[1] : null; } },
    { id: 'apertura', p: 0.9, q: () => '¿Qué tipo de apertura?', fn: (d) => { const m = d.nr.match(/(oscilobatiente|corredera|practicable|abatible|fij[oa]|pivotante|plegable|basculante)/); return m ? m[1].replace(/fij[oa]/, 'fija') : null; } },
    { id: 'hojas', p: 0.8, q: () => '¿Cuántas hojas?', fn: (d) => { const m = d.nr.match(/(\d)\s+hojas?/); return m ? m[1] + (m[1] === '1' ? ' hoja' : ' hojas') : null; } },
    { id: 'intensidad', p: 0.6, q: () => '¿De qué intensidad?', fn: (d) => { const m = d.nr.match(/(\d+)\s*a\b/); return m ? m[1] + ' A' : null; } }
  ];

  /* ---------------- Sinónimos de obra (coloquial → BC3) ---------------- */
  const SYN_RAW = {
    picado: 'demolicion picado levantado', picar: 'demolicion picado', pica: 'demolicion picado',
    quitar: 'demolicion desmontaje levantado arranque', retirar: 'demolicion desmontaje levantado retirada', arrancar: 'demolicion arranque levantado',
    tirar: 'demolicion derribo', derribar: 'demolicion derribo', demoler: 'demolicion', derribo: 'demolicion derribo', desmontar: 'desmontaje', levantar: 'levantado demolicion',
    azulejo: 'alicatado azulejo', azulejos: 'alicatado azulejo', alicatar: 'alicatado', alicatados: 'alicatado', baldosa: 'baldosa solado pavimento', baldosas: 'baldosa solado pavimento',
    suelo: 'suelo solado pavimento', suelos: 'suelo solado pavimento', pavimento: 'pavimento solado', solar: 'solado pavimento', solado: 'solado pavimento',
    pintar: 'pintura', pinto: 'pintura', pared: 'paramento pared vertical', paredes: 'paramento pared vertical',
    techo: 'techo horizontal', techos: 'techo horizontal', pladur: 'yeso laminado placa', escayola: 'escayola', yeso: 'yeso guarnecido enlucido',
    enlucir: 'enlucido', enlucido: 'enlucido guarnecido', guarnecer: 'guarnecido', enfoscar: 'enfoscado', revocar: 'revoco', tabicar: 'tabique tabiqueria', tabique: 'tabique tabiqueria',
    enchufe: 'toma de corriente', enchufes: 'toma de corriente', interruptor: 'interruptor', luz: 'luz alumbrado', luces: 'luz alumbrado',
    grifo: 'griferia grifo', grifos: 'griferia grifo', vater: 'inodoro', water: 'inodoro', wc: 'inodoro', retrete: 'inodoro', vateres: 'inodoro',
    ducha: 'ducha plato', banera: 'banera', termo: 'termo acumulador calentador', calentador: 'calentador acumulador', radiador: 'radiador emisor',
    split: 'split aire acondicionado', aire: 'aire acondicionado split', clima: 'climatizacion aire acondicionado', climatizacion: 'climatizacion aire',
    cristal: 'vidrio acristalamiento', cristales: 'vidrio acristalamiento', escombro: 'residuo escombro contenedor', escombros: 'residuo escombro contenedor',
    impermeabilizar: 'impermeabilizacion', aislar: 'aislamiento', roza: 'roza', rozas: 'roza', regata: 'roza', regatas: 'roza',
    zocalo: 'rodapie zocalo', rodapie: 'rodapie', tarima: 'tarima madera parquet', parquet: 'parquet tarima', barandilla: 'barandilla', reja: 'reja cerrajeria',
    canalon: 'canalon', bajante: 'bajante', desague: 'desague evacuacion', tuberia: 'tuberia tubo', tuberias: 'tuberia tubo', cable: 'cable conductor circuito', cableado: 'cable conductor circuito',
    ventana: 'ventana carpinteria', ventanas: 'ventana carpinteria', puerta: 'puerta block carpinteria', puertas: 'puerta block carpinteria',
    hormigonar: 'hormigon', solera: 'solera', fachada: 'fachada', tejado: 'cubierta teja', tejas: 'teja cubierta', mampara: 'mampara',
    fregadero: 'fregadero', encimera: 'encimera', muebles: 'mueble', mueble: 'mueble', lavabo: 'lavabo', bide: 'bide', plato: 'plato ducha'
  };
  const SYN = {};
  // Cada sinónimo es una palabra o frase: 'yeso laminado' exige ambas palabras.
  const PHRASES = { 'toma de corriente': 1, 'yeso laminado': 1, 'aire acondicionado': 1, 'punto de luz': 1, 'falso techo': 1, 'plato ducha': 1 };
  for (const k in SYN_RAW) {
    const raw = SYN_RAW[k]; const out = []; let rest = ' ' + raw + ' ';
    Object.keys(PHRASES).forEach((ph) => { if (rest.includes(' ' + ph + ' ')) { out.push(words(ph).filter((w) => !STOP.has(w)).map(stem)); rest = rest.replace(' ' + ph + ' ', ' '); } });
    rest.trim().split(/\s+/).filter(Boolean).forEach((w) => out.push([stem(norm(w))]));
    SYN[stem(norm(k))] = out;
  }

  /* ---------------- Índice de búsqueda ---------------- */
  class Index {
    /** docs: [{key, r, t, chapTitle, subTitle, path}] */
    constructor(docs) {
      this.docs = docs;
      this.inv = new Map(); // stem -> Map(docIdx -> fieldWeight)
      docs.forEach((d, i) => {
        d.nr = norm(d.r); d.nt = norm(d.t);
        const add = (txt, w) => {
          for (const x of words(txt)) {
            if (STOP.has(x) || x.length < 2) continue;
            const s = stem(x);
            let m = this.inv.get(s);
            if (!m) { m = new Map(); this.inv.set(s, m); }
            if ((m.get(i) || 0) < w) m.set(i, w);
          }
        };
        add(d.t, 0.45); add(d.path || '', 0.55); add(d.subTitle || '', 0.75); add(d.r, 1.0);
      });
      this.vocab = [...this.inv.keys()];
      this.N = docs.length;
    }
    /** Variantes de un término de la consulta: [{stem, w}] */
    variants(q) {
      const s = stem(q), out = new Map([[s, { ph: [s], w: 1 }]]);
      (SYN[s] || []).forEach((ph) => { const k = ph.join(' '); if (!out.has(k)) out.set(k, { ph, w: 0.9 }); });
      return [...out.values()];
    }
    /** Mapa doc → calidad para un término (stem) */
    termMap(stemv) {
      const acc = new Map();
      for (const m of this.vocabMatches(stemv)) {
        for (const [di, fw] of this.inv.get(m.stem)) { const sc = m.q * fw; if ((acc.get(di) || 0) < sc) acc.set(di, sc); }
      }
      return acc;
    }
    /** Términos del vocabulario que casan con una variante: [{stem, q}] */
    vocabMatches(v) {
      const res = [];
      if (this.inv.has(v)) res.push({ stem: v, q: 1 });
      if (v.length >= 4 && !/^\d/.test(v)) {
        for (const t of this.vocab) {
          if (t === v) continue;
          if (t.startsWith(v) && t.length - v.length <= 5) res.push({ stem: t, q: 0.82 });
          else if (v.startsWith(t) && t.length >= 5) res.push({ stem: t, q: 0.75 });
          else if (v.length >= 5 && lev1(t, v)) res.push({ stem: t, q: 0.7 });
        }
      }
      return res;
    }
    /** Busca. Devuelve [{i, doc, s}] ordenado. boost(doc) → multiplicador opcional. */
    search(query, boost) {
      const qw = [...new Set(words(query).filter((w) => !STOP.has(w) && w.length > 1))];
      if (!qw.length) return [];
      const perTerm = qw.map((w) => {
        const acc = new Map(); // docIdx -> best
        for (const v of this.variants(w)) {
          const maps = v.ph.map((x) => this.termMap(x));
          for (const [di, sc0] of maps[0]) {
            let sc = sc0;
            for (let k = 1; k < maps.length && sc > 0; k++) sc = Math.min(sc, maps[k].get(di) || 0);
            sc *= v.w;
            if (sc > 0 && (acc.get(di) || 0) < sc) acc.set(di, sc);
          }
        }
        const df = acc.size;
        const imp = df === 0 ? 0.25 : Math.log(1 + this.N / df);
        return { acc, imp };
      });
      const totImp = perTerm.reduce((a, b) => a + b.imp, 0);
      const scores = new Map();
      perTerm.forEach(({ acc, imp }) => {
        for (const [di, sc] of acc) scores.set(di, (scores.get(di) || 0) + sc * imp);
      });
      const out = [];
      for (const [di, sc] of scores) {
        let s = sc / totImp;
        if (boost) s *= boost(this.docs[di]);
        out.push({ i: di, doc: this.docs[di], s });
      }
      out.sort((a, b) => b.s - a.s || a.doc.r.length - b.doc.r.length);
      return out;
    }
  }

  /** Prepara un catálogo (de parseBC3) para búsqueda: rutas de capítulos, atributos… */
  function prepareCatalog(cat) {
    const chapRoot = (c) => { let x = c, guard = 0; while (cat.capitulos[x] && cat.capitulos[x].p && guard++ < 20) x = cat.capitulos[x].p; return x; };
    const order = {}; cat.raiz.forEach((c, i) => { order[c] = i; });
    const docs = cat.partidas.map((p) => {
      const root = chapRoot(p.ch);
      const path = []; let x = p.ch, guard = 0;
      while (x && cat.capitulos[x] && guard++ < 20) { path.unshift(cat.capitulos[x].t); x = cat.capitulos[x].p; }
      return {
        key: p.c, c: p.c, u: p.u, r: p.r, t: p.t,
        chap: root, chapTitle: (cat.capitulos[root] || {}).t || 'GENERAL', chapOrder: order[root] ?? 999,
        subTitle: (cat.capitulos[p.ch] || {}).t || '', path: path.join(' · ')
      };
    });
    const index = new Index(docs);
    docs.forEach((d) => { d.attrs = {}; for (const a of ATTRS) d.attrs[a.id] = attrValue(a, d); });
    const byCode = new Map(docs.map((d) => [d.c, d]));
    return { meta: cat, docs, index, byCode, chapOrder: order };
  }
  function attrValue(a, d) {
    if (a.from) return a.from(d) || null;
    if (a.fn) return a.fn(d);
    const txt = a.src === 'r' ? d.nr : d.nr + ' ' + d.nt;
    let best = null, bp = Infinity;
    for (const [lab, re] of a.vals) { const m = txt.match(re); if (m && m.index < bp) { bp = m.index; best = lab; } }
    return best;
  }

  /* ---------------- Embudo ---------------- */
  function entropy(counts) {
    const n = counts.reduce((a, b) => a + b, 0); let e = 0;
    counts.forEach((c) => { if (c) { const p = c / n; e -= p * Math.log2(p); } });
    return e;
  }
  /** Elige el atributo que mejor divide a los candidatos. */
  function bestSplit(cands, asked) {
    let best = null;
    for (const a of ATTRS) {
      if (asked.has(a.id)) continue;
      const groups = new Map(); let nulls = 0;
      cands.forEach((c) => { const v = c.doc.attrs[a.id]; if (v === null || v === undefined) nulls++; else groups.set(v, (groups.get(v) || 0) + 1); });
      const k = groups.size;
      if (k === 0 || (k === 1 && nulls === 0)) continue;
      if (k === 1 && nulls > 0 && a.id !== 'medios' && a.id !== 'recup' && a.id !== 'carga') continue;
      const counts = [...groups.values()]; if (nulls) counts.push(nulls);
      let sc = entropy(counts) * a.p;
      if (k > 6) sc *= 0.55;
      if (nulls > cands.length / 2) sc *= 0.6;
      if (!best || sc > best.sc) {
        const opts = [...groups.entries()].sort((x, y) => y[1] - x[1]).map(([v]) => v);
        best = { a, sc, opts, nulls };
      }
    }
    return best;
  }
  /** ¿El texto menciona algún valor de atributo? → filtra candidatos. */
  function prefilter(cands, text) {
    const n = norm(text);
    let out = cands;
    for (const a of ATTRS) {
      if (a.id === 'capitulo' || a.id === 'sub') continue;
      const vals = new Set(out.map((c) => c.doc.attrs[a.id]).filter(Boolean));
      if (vals.size < 2) continue;
      const hit = [...vals].filter((v) => valueMentioned(a, v, n));
      if (hit.length === 1) {
        const f = out.filter((c) => c.doc.attrs[a.id] === hit[0]);
        if (f.length) out = f;
      }
    }
    return out;
  }
  function valueMentioned(a, v, n) {
    if (a.vals) {
      const def = a.vals.find((x) => x[0] === v);
      if (def && def[1].test(n)) return true;
      if (a.id === 'medios') return v === 'manuales' ? /\bmano\b|manual/.test(n) : /mecanic|maquina|martillo/.test(n);
    }
    const nv = norm(v).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!nv) return false;
    if (/^\d/.test(nv)) return new RegExp('\\b' + nv.split(' ')[0].replace(/[.,]/g, '[.,]') + '\\b').test(n.replace(/,/g, ','));
    return words(nv).every((w) => n.includes(stem(w)));
  }
  /** Empareja la respuesta del usuario con una lista de etiquetas. Devuelve índice o -1. */
  function matchOption(text, labels) {
    const n = norm(text).replace(/[^a-z0-9,. ]+/g, ' ');
    // ordinales "la primera", "opción 2", "la 3"
    const om = n.match(/\b(?:opcion|la|el|numero)\s+(\w+)\b/);
    for (const k in ORD) if (new RegExp('\\b' + k + '\\b').test(n) && ORD[k] > 0 && ORD[k] <= labels.length) return ORD[k] - 1;
    if (/^\s*(?:\d+|[a-z]+)\s*$/.test(n) && !contentWords(n).length) { const v = parseNumber(n); if (v && Number.isInteger(v) && v >= 1 && v <= labels.length && !labels.some((l) => new RegExp('\\b' + v + '\\b').test(norm(l)))) return v - 1; }
    if (om) { const v = parseNumber(om[1]); if (v && v >= 1 && v <= labels.length && Number.isInteger(v)) return v - 1; }
    let best = -1, bs = 0;
    const qn = words(n).filter((w) => !STOP.has(w));
    const qnum = n.match(/\d+(?:[.,]\d+)?/g) || [];
    labels.forEach((l, i) => {
      const ln = norm(l);
      if (ln.trim() === n.trim()) { bs = 99; best = i; return; }
      const lw = words(ln).filter((w) => !STOP.has(w));
      if (!lw.length) return;
      let hit = 0;
      lw.forEach((w) => { const s = stem(w); if (qn.some((q) => stem(q) === s || (s.length >= 4 && stem(q).startsWith(s.slice(0, 4))) || (q.length >= 5 && lev1(stem(q), s)))) hit++; });
      const lnum = ln.match(/\d+(?:[.,]\d+)?/g) || [];
      if (lnum.length && qnum.length) {
        if (lnum.some((x) => qnum.includes(x) || qnum.includes(x.replace(',', '.')))) hit += 1.5; else hit -= 1;
      }
      // conflicto con/sin
      if (/\bsin\b/.test(ln) !== /\bsin\b/.test(n) && /\b(con|sin)\b/.test(n)) hit -= 1;
      const sc = hit / lw.length;
      if (sc > bs) { bs = sc; best = i; }
    });
    // Valor numérico hablado ("siete") contra etiquetas "7 cm"
    if (bs < 0.5) {
      const v = parseNumber(text);
      if (v !== null) labels.forEach((l, i) => { const m = norm(l).match(/\d+(?:[.,]\d+)?/); if (m && parseFloat(m[0].replace(',', '.')) === v) { best = i; bs = 1; } });
    }
    return bs >= 0.5 ? best : -1;
  }

  /* ---------------- Inteligencia dimensional ---------------- */
  const RE_H = /\b(suelo|solado|pavimento|solera|techo|falso techo|forjado|cubierta|horizontal|cielo raso|tarima|parquet|losa|azotea|terraza|recrecido|autonivelante|capa de compresion|placa alveolar|zahorra|explanada|desbroce)\b/;
  const RE_V = /\b(alicatado|paramento vertical|pared|tabique|tabiqueria|fachada|enlucido|guarnecido|enfoscado|vertical|muro|cerramiento|aplacado|trasdosado|hoja de|fabrica de|medianera|revestimiento vertical|celosia|mampara|tapia)\b/;
  function orientOf(d) {
    const r = norm(d.r), s = norm(d.subTitle || ''), t = norm((d.t || '').slice(0, 300));
    if (/pintura|empapelado|estuco|barniz/.test(r) && !/techo|suelo|pavimento|horizontal/.test(r)) return 'V';
    const hr = RE_H.test(r), vr = RE_V.test(r);
    if (hr && !vr) return 'H'; if (vr && !hr) return 'V';
    const hs = RE_H.test(s), vs = RE_V.test(s);
    if (hs && !vs) return 'H'; if (vs && !hs) return 'V';
    const ih = t.search(RE_H), iv = t.search(RE_V);
    if (ih >= 0 && (iv < 0 || ih < iv)) return /pintura/.test(r) ? 'V' : 'H';
    if (iv >= 0) return 'V';
    return 'H';
  }
  const isCarpinteria = (p) => /ventana|ventanal|puerta|balconera|block|carpinteria|persiana|mampara|contraventana|hueco|vidrio|acristalamiento/.test(norm(p.r + ' ' + (p.subTitle || '')));

  /** Qué dimensiones necesita una partida (según unidad y orientación). */
  function dimsSpec(p) {
    switch (p.u) {
      case 'ud': return { need: [], ask: isCarpinteria(p) ? '¿Cuántas unidades y qué medida, ancho por alto?' : '¿Cuántas unidades?' };
      case 'm': return { need: ['l'], ask: '¿Longitud? Si son varios tramos iguales, dime cuántos.' };
      case 'm2': return p.orient === 'V' ? { need: ['l', 'h'], ask: '¿Largo y alto?' } : { need: ['l', 'a'], ask: '¿Largo y ancho?' };
      case 'm3': return { need: ['l', 'a', 'h'], ask: '¿Largo, ancho y alto o espesor?' };
      default: return { need: [], ask: '¿Qué cantidad, en ' + unitSpoken(p.u) + '?' };
    }
  }
  const DIM_NAME = { l: 'el largo', a: 'el ancho', h: 'el alto' };

  /**
   * Convierte un dictado parseado en línea para la partida p.
   * Devuelve { line, warn, missing:[dims], pending }
   */
  function buildLine(p, pm, prev) {
    const warn = [];
    let orient = p.orient;
    if (p.u === 'm2' && pm.orientHint && /pintura|revestimiento|yeso|enlucido|guarnecido|placa/.test(norm(p.r))) orient = pm.orientHint;
    const spec = p.u === 'm2' ? (orient === 'V' ? ['l', 'h'] : ['l', 'a']) : dimsSpec(p).need;
    const line = { uds: null, l: null, a: null, h: null, hueco: null };
    let dims = pm.dims.slice();
    // dims etiquetadas explícitamente ("largo 3, alto 2,5")
    const lab = pm.labeled;
    if (prev) { // completando una medida pendiente
      Object.assign(line, prev);
    }
    if (p.u === 'ud' || !['m', 'm2', 'm3'].includes(p.u)) {
      if (pm.n !== null) {
        line.uds = pm.n;
        if (p.u === 'ud' && dims.length >= 2) { line.hueco = { a: dims[0], h: dims[1] }; dims = dims.slice(2); }
      } else if (dims.length) {
        if (p.u === 'ud' && dims.length >= 2 && isCarpinteria(p)) { line.uds = 1; line.hueco = { a: dims[0], h: dims[1] }; dims = dims.slice(2); }
        else { line.uds = dims.shift(); }
      }
      if (dims.length) warn.push(p.u === 'ud' ? 'Esta partida es por unidades, descarto las medidas sobrantes.' : 'Solo necesito la cantidad, descarto el resto.');
      if (line.uds === null) return { missing: ['n'] };
      return { line, warn };
    }
    // N explícito ("2 de 3,40 por 2,50")
    if (pm.n !== null) line.uds = pm.n;
    for (const k of ['l', 'a', 'h']) if (lab[k] !== undefined) {
      if (spec.includes(k)) line[k] = lab[k];
      else if (p.u === 'm2' && k !== 'l') { const other = spec[1]; if (line[other] === null) line[other] = lab[k]; }
    }
    // "2 por 3,5" en m → 2 tramos de 3,5
    if (p.u === 'm' && pm.n === null && dims.length >= 2 && Number.isInteger(dims[0]) && dims[0] <= 50 && line.l === null) {
      line.uds = dims.shift();
    }
    for (const k of spec) if (line[k] === null && dims.length) line[k] = dims.shift();
    if (dims.length) {
      if (p.u === 'm2') warn.push('Esta partida es en metros cuadrados, descarto ' + (spec.includes('h') ? 'la tercera medida' : 'la altura') + ' para no alterar el cálculo.');
      else if (p.u === 'm') warn.push('Esta partida es en metros lineales, solo tomo la longitud.');
      else warn.push('Descarto las medidas sobrantes.');
    }
    const missing = spec.filter((k) => line[k] === null);
    if (missing.length) return { missing, pending: line };
    if (line.uds === null) line.uds = 1;
    return { line, warn };
  }
  function parcial(l) {
    let v = l.uds === null || l.uds === undefined ? 1 : l.uds;
    for (const k of ['l', 'a', 'h']) if (l[k] !== null && l[k] !== undefined) v *= l[k];
    return round2(v);
  }
  const totalOf = (p) => round2(p.lineas.reduce((a, l) => a + parcial(l), 0));

  /* ---------------- Herencia geométrica ---------------- */
  function inheritGroup(p, query) {
    const r = norm(p.r + ' ' + (p.subTitle || '')), q = norm(query || '');
    if (/techo|cielo/.test(q)) return 'H';
    if (/suelo|pavimento|solado/.test(q)) return 'H';
    if (/pared|paramento/.test(q)) return 'V';
    if (/falso techo|techo|cielo raso|solado|pavimento|suelo|solera|tarima|parquet|recrecido|autonivelante/.test(r) && !/rodapie|zocalo/.test(r)) return 'H';
    if (/guarnecido|enlucido|enfoscado|pintura|revestimiento|alicatado|paramento|revoco|estuco|empapelado|tabique/.test(r)) return 'V';
    return null;
  }

  /* ---------------- Estancias ---------------- */
  const EST_VOCAB = /^(salon|salon comedor|comedor|cocina|bano|aseo|dormitorio|habitacion|pasillo|recibidor|entrada|hall|terraza|balcon|galeria|lavadero|despensa|vestidor|estudio|despacho|garaje|trastero|sotano|buhardilla|atico|escalera|escaleras|distribuidor|porche|patio|jardin|fachada|cubierta|tejado|azotea|local|oficina|almacen|nave|zona|planta|exterior|interior|piscina|suite|cuarto|sala|dormitorio principal|bano principal|lavanderia|bodega|caja de escalera|zaguan|portal|tienda|aseos|vestuario|vestuarios)\b/;
  function estanciaName(raw) {
    let s = norm(raw).replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(el|la|los|las|al|a|en|del|de)\b\s*/g, (m, w, off) => off === 0 ? '' : m).trim();
    s = s.replace(/^(el|la|los|las|al|a|en)\s+/, '');
    // números en palabra → dígito
    s = s.split(' ').map((w) => (w in NUMW && w !== 'un' && w !== 'una') ? String(NUMW[w]) : w).join(' ');
    s = s.replace(/\bbano\b/g, 'baño').replace(/\bsalon\b/g, 'salón').replace(/\bhabitacion\b/g, 'habitación').replace(/\bbalcon\b/g, 'balcón')
      .replace(/\bjardin\b/g, 'jardín').replace(/\bsotano\b/g, 'sótano').replace(/\batico\b/g, 'ático').replace(/\balmacen\b/g, 'almacén').replace(/\bgaleria\b/g, 'galería').replace(/\blavanderia\b/g, 'lavandería');
    return titleCase(s);
  }
  function matchEstancia(name, list) {
    const n = norm(name);
    const ex = list.find((e) => norm(e) === n); if (ex) return ex;
    if (!/\d/.test(n)) { const pre = list.filter((e) => norm(e).startsWith(n + ' ')); if (pre.length === 1) return pre[0]; }
    return name;
  }
  const DEFAULT_ESTANCIAS = ['Salón', 'Cocina', 'Baño 1', 'Dormitorio 1', 'Dormitorio 2', 'Pasillo', 'Terraza'];

  /* ---------------- Ámbitos ---------------- */
  const AMBITOS = {
    vivienda: { label: 'Vivienda / Reforma integral', kw: null },
    estancia: { label: 'Estancia específica', kw: /demolic|solad|alicat|fontaner|sanitar|revoc|enluc|pintur|electric|carpinter|falso|revest|griferi|aparatos/ },
    carpinteria: { label: 'Carpintería', kw: /carpinter|cerrajer|acristal|vidri|alumin|madera|ventan|puert/ },
    instalaciones: { label: 'Instalaciones', kw: /fontaner|calefac|electric|aire acond|energia solar|saneamiento|ventilac|contraincend|telecom|instalac|climatiz/ },
    libre: { label: 'Medición libre', kw: null }
  };
  function ambitoFromText(t) {
    const n = norm(t);
    if (/integral|vivienda|piso|casa|reforma completa|toda la/.test(n)) return { id: 'vivienda' };
    if (/carpinter|ventana|puerta|huecos/.test(n)) return { id: 'carpinteria' };
    if (/instalac|electric|fontaner|clima|calefac|aire/.test(n)) return { id: 'instalaciones' };
    if (/libre|sin restric|cualquier/.test(n)) return { id: 'libre' };
    const m = n.match(/(bano|cocina|local|aseo|oficina|salon|dormitorio|terraza|estancia)/);
    if (m) return { id: 'estancia', est: m[1] === 'estancia' ? null : estanciaName(m[1]) };
    return null;
  }

  /* ============================================================
   * GESTOR DE DIÁLOGO
   * io: { say(text, chips?, opts?), user(text), save(), render(), getCatalog(), exportPdf(), focus(view) }
   * ============================================================ */
  class Dialog {
    constructor(io) {
      this.io = io;
      this.state = { mode: 'idle' };
      this.obra = null;
      this.undo = [];
      this.lastPrompt = null;
    }
    get cat() { return this.io.getCatalog(); }
    setObra(obra) {
      this.obra = obra; this.undo = []; this.state = { mode: 'idle' };
      if (!obra) return;
      if (!obra.ambito) return this.askAmbito(true);
      const act = this.active();
      const est = obra.estActiva ? ' Estancia: ' + obra.estActiva + '.' : '';
      this.ask('Obra ' + obra.titulo + ' abierta.' + est + (act ? ' Partida activa: ' + act.r + '.' : '') + ' Dime el trabajo a medir.', this.idleChips());
    }
    /* ---- helpers de salida ---- */
    ask(text, chips, opts) { this.lastPrompt = { text, chips, opts }; this.io.say(text, chips || [], Object.assign({ listen: true }, opts || {})); }
    tell(text, chips) { this.ask(text, chips, { listen: true }); }
    idleChips() {
      const c = [];
      if (this.active()) c.push({ label: 'Siguiente partida', value: 'siguiente partida' }, { label: 'Leer líneas', value: 'lee las líneas' });
      if (this.obra && this.obra.ambito !== 'libre') c.push({ label: 'Cambiar estancia', value: 'siguiente estancia' });
      return c;
    }
    snapshot() { this.undo.push(JSON.stringify(this.obra)); if (this.undo.length > 40) this.undo.shift(); }
    touch() { this.obra.updated = Date.now(); this.io.save(); this.io.render(); }
    active() { return this.obra && this.obra.partidas.find((p) => p.uid === this.obra.activa) || null; }
    estPrefix() { return this.obra.estActiva || ''; }

    /* ---- entrada ---- */
    handle(input) {
      if (!this.obra) return;
      let text = typeof input === 'string' ? input.trim() : '';
      if (typeof input === 'string') { if (!text) return; this.io.user(text); }
      else if (input && input.label) {
        this.io.user(input.label);
        if (!input.act) { text = String(input.value || input.label); input = text; }
      }
      const n = norm(text);
      // Comandos globales que funcionan en cualquier estado
      if (text) {
        if (/^(cancela|cancelar|olvidalo|dejalo|nada|salir)\b/.test(n)) { this.state = { mode: 'idle' }; return this.ask('Cancelado. ¿Qué medimos?', this.idleChips()); }
        if (/^(repite|repitelo|como|que has dicho|perdona)\b/.test(n) && this.lastPrompt) return this.ask(this.lastPrompt.text, this.lastPrompt.chips);
        if (/^(ayuda|que puedo decir|comandos)\b/.test(n)) return this.help();
        if (/^(deshaz|deshacer|deshace|anula lo ultimo|anula)\b/.test(n)) return this.doUndo();
      }
      const st = this.state;
      const h = this['st_' + st.mode];
      if (h) return h.call(this, text, n, input);
      return this.st_idle(text, n, input);
    }
    help() {
      this.ask('Puedes decir un trabajo, por ejemplo "picado de azulejos", y luego las medidas: "pared ducha 1,80 por 2,50". ' +
        'También: "descuenta puerta de 0,82 por 2,03", "pasamos al baño", "lee las líneas", "borra la última línea", ' +
        '"cambia el largo de la línea 2 a 3 con 40", "qué llevo medido en la cocina", "aplica las mismas medidas que en el pavimento", "siguiente partida" o "deshacer".', this.idleChips());
    }
    doUndo() {
      if (!this.undo.length) return this.ask('No hay nada que deshacer.');
      const prev = JSON.parse(this.undo.pop());
      Object.keys(this.obra).forEach((k) => delete this.obra[k]);
      Object.assign(this.obra, prev);
      this.state = { mode: 'idle' };
      this.touch();
      this.ask('Deshecho.', this.idleChips());
    }

    /* ---- Ámbito y estancias ---- */
    askAmbito(first) {
      this.state = { mode: 'ambito' };
      this.ask((first ? 'Obra creada. ' : '') + '¿Cuál es el ámbito de la visita? Vivienda o reforma integral, estancia específica, carpintería, instalaciones o medición libre.',
        Object.keys(AMBITOS).map((k) => ({ label: AMBITOS[k].label, value: k === 'estancia' ? 'estancia específica' : AMBITOS[k].label, act: { ambito: k } })));
    }
    st_ambito(text, n, input) {
      const r = input && input.act && input.act.ambito ? { id: input.act.ambito } : ambitoFromText(text);
      if (!r) return this.ask('No te he entendido. ¿Vivienda, estancia específica, carpintería, instalaciones o libre?', this.lastPrompt.chips);
      this.obra.ambito = r.id;
      if (r.est) { this.setEstancia(r.est, true); this.touch(); this.state = { mode: 'idle' }; return this.ask('Perfecto, medimos ' + art(r.est) + '. ¿Cuál es el primer trabajo? Por ejemplo: picado de azulejos.'); }
      this.touch();
      if (r.id === 'libre') { this.state = { mode: 'idle' }; return this.ask('Medición libre. Dime el primer trabajo a medir.'); }
      return this.askEstancia(r.id === 'instalaciones');
    }
    askEstancia(optional) {
      this.state = { mode: 'estancia' };
      const used = this.obra.estancias || [];
      const sugg = (this.obra.ambito === 'estancia' ? ['Baño', 'Cocina', 'Aseo', 'Local'] : DEFAULT_ESTANCIAS).filter((e) => !used.includes(e));
      const chips = sugg.slice(0, 7).map((e) => ({ label: e, value: e }));
      if (optional) chips.push({ label: 'Sin estancia', value: 'sin estancia' });
      this.ask(used.length ? '¿A qué estancia pasamos?' : '¿Por qué estancia empezamos?', chips);
    }
    st_estancia(text, n) {
      if (/sin estancia|ninguna|general/.test(n)) { this.obra.estActiva = ''; this.touch(); this.state = { mode: 'idle' }; return this.ask('Sin estancia. Dime el trabajo a medir.'); }
      const name = estanciaName(text.replace(/^(pasamos|vamos|empezamos|estamos)\s+(a|al|a la|en|en el|en la|por|por el|por la)?\s*/i, ''));
      if (!name) return this.ask('¿Qué estancia?', this.lastPrompt.chips);
      this.setEstancia(name);
      this.state = { mode: 'idle' };
      this.touch();
      const act = this.active();
      this.ask('Estamos en ' + art(this.obra.estActiva) + '. ' + (act ? '¿Medimos aquí ' + act.r + '? Dicta las medidas, o dime otro trabajo.' : '¿Qué trabajos hay aquí? Por ejemplo: picado de azulejos, solado, pintura…'), this.idleChips());
    }
    setEstancia(name, silent) {
      const list = this.obra.estancias || (this.obra.estancias = []);
      const e = matchEstancia(name, list);
      if (!list.includes(e)) list.push(e);
      this.obra.estActiva = e;
    }
    nextEstancia() {
      const list = this.obra.estancias || [];
      const pool = this.obra.ambito === 'estancia' ? ['Baño', 'Cocina', 'Aseo', 'Local'] : DEFAULT_ESTANCIAS;
      const next = pool.find((e) => !list.includes(e));
      this.askEstancia(this.obra.ambito === 'instalaciones');
      if (next && this.lastPrompt) this.lastPrompt.text = this.lastPrompt.text;
    }

    /* ---- Estado idle / medición ---- */
    st_idle(text, n, input) {
      if (input && input.act) return this.handleAct(input.act);
      if (!text) return;
      const act = this.active();

      if (this.tryCommands(text, n) !== false) return;

      // Medición
      const pm = parseMeasure(text);
      if (pm.count > 0 || pm.n !== null) {
        if (act && this.looksLikeMeasure(pm, text, act)) return this.addMeasure(pm, text);
        if (!act && pm.ded) return this.ask('Primero dime a qué partida descuento el hueco.');
        if (!act && pm.count >= 2) return this.ask('No hay ninguna partida activa. Dime primero el trabajo, por ejemplo "alicatado de paredes".');
      }
      if (act && /^(si|vale|ok|sigue|seguimos|otra|otra medida|mas)$/.test(n)) return this.ask(dimsSpec(act).ask);
      // Refinar la última búsqueda: "mecánicos", "exterior"…
      if (this.lastQuery && /^(con |de |en |por )?(medios )?(manual(es)?|mecanic[oa]s?|a mano|a maquina|interior|exterior|con recuperacion|sin recuperacion|con carga|sin carga)$/.test(n)) {
        const res = this.cat.index.search(this.lastQuery, this.boostFn());
        const cands = res.filter((r) => r.s >= (res[0] ? res[0].s * 0.8 : 0)).slice(0, 60);
        const f = prefilter(cands, text);
        if (f.length === cands.length || !f.length || (act && f.some((r) => r.doc.c === act.ref))) return this.ask('En la base no hay otra variante' + (act ? '; sigo con ' + act.r + '. ' + dimsSpec(act).ask : '.'), this.idleChips());
        return this.funnelStart(this.lastQuery + ' ' + text, f, []);
      }
      return this.selectWork(text);
    }
    /** Comandos reconocibles en cualquier momento. Devuelve false si no es un comando. */
    tryCommands(text, n) {
      const act = this.active();
      let m;
      // Estancias
      if (/^(siguiente|otra|cambio de|cambiar de|cambia de|cambiar|nueva) estancia\b/.test(n)) return this.nextEstancia();
      m = n.match(/^(?:pasamos|vamos|pasa|cambiamos|cambia|nos vamos|seguimos|ahora|estamos|entramos)\s+(?:a|al|a la|en|en el|en la|por|por el|por la|con el|con la)\s+(.+)$/) || n.match(/^estancia\s+(.+)$/);
      if (m && (EST_VOCAB.test(m[1].replace(/^(el|la)\s+/, '')) || n.startsWith('estancia') || (this.obra.estancias || []).some((e) => norm(e) === m[1].replace(/^(el|la)\s+/, '')))) {
        return this.st_estancia(m[1], norm(m[1]));
      }

      // Revisión y navegación
      if (/(revisa|repasa|muestra|muestrame|ensena|ensename|ver|dime|abre)\s+(la\s+)?(ultima|anterior)\s+partida/.test(n)) return this.reviewLast();
      if (/^(lee|leeme|dime|repasa)\s+(las\s+)?(lineas|medidas|mediciones)|^lee la partida|^que lleva(mos)? (esta|la) partida/.test(n)) return this.readLines();
      if ((m = n.match(/^(?:borra|elimina|quita|suprime)\s+(?:la\s+)?(ultima|penultima)\s+linea/))) return this.deleteLine(m[1] === 'ultima' ? -1 : -2);
      if ((m = n.match(/^(?:borra|elimina|quita|suprime)\s+(?:la\s+)?linea\s+(?:numero\s+)?(.+)$/))) return this.deleteLine(parseIndex(m[1]));
      if (/^(borra|elimina)\s+(la|esta)\s+partida/.test(n)) return this.confirmDeletePartida();
      if ((m = n.match(/^(?:cambia|corrige|modifica|pon)\s+(?:el|la|las|los)\s+(largo|longitud|ancho|anchura|alto|altura|espesor|unidades|uds|comentario)\s+(?:de|en)\s+la\s+linea\s+(\S+)\s+(?:a|por|en|que sea)\s+(.+)$/))) return this.editLineField(parseIndex(m[2]), m[1], text.slice(text.toLowerCase().lastIndexOf(m[3].split(' ')[0])));
      if ((m = n.match(/^(?:cambia|corrige|modifica)\s+la\s+(?:ultima\s+linea|linea\s+(\S+))\s+(?:a|por|en)\s+(.+)$/))) return this.replaceLine(m[1] ? parseIndex(m[1]) : -1, m[2]);
      if ((m = n.match(/^(?:que|cuanto)\s+(?:llevo|llevamos|tengo|tenemos|hay|he|hemos)\s+(?:medido\s+)?(?:en|del|de)\s+(?:el|la)?\s*(.+)$/)) || (m = n.match(/^resumen\s+(?:de|del)\s+(?:la\s+|el\s+)?(.+)$/))) return this.summaryEstancia(m[1]);
      if (/^(resumen|total)( de la obra| general)?$|^que llevo medido$/.test(n)) return this.summaryObra();
      if (/^(exporta|genera|saca|crea)\s+(el\s+)?(pdf|informe|listado)/.test(n)) { this.io.exportPdf(); return this.ask('Generando el PDF de mediciones.'); }

      // Herencia geométrica por comando
      if ((m = n.match(/^(?:aplica|usa|pon|copia|coge|toma)\s+(?:las\s+)?(?:mismas\s+)?(?:medidas|superficies|mediciones|lineas)\s+(?:que|de|del)\s+(?:en\s+)?(?:el|la|los|las)?\s*(.+)$/))) return this.cmdCopyFrom(m[1]);
      if ((m = n.match(/^copia\s+(?:las\s+|los\s+)?(paredes|paramentos|suelos?|techos?|medidas)\s+(?:del|de la|de|de los)\s+(.+?)(?:\s+(?:pero\s+)?(?:descuenta|descontando|quitando|restando|y descuenta|menos)\s+(?:las\s+|los\s+)?(ventanas|puertas|huecos|carpinterias?))?$/))) return this.cmdCopyRoom(m[1], m[2], m[3]);

      // Fin de partida
      if (/^(siguiente partida|nueva partida|otra partida|terminado|termina|fin de (la )?partida|cerramos (la )?partida|ya esta|listo|vale ya|cambio de partida|cambiamos de partida)$/.test(n)) {
        this.obra.activa = null; this.touch();
        const e = this.obra.estActiva;
        if (e && this.obra.ambito !== 'libre') return this.ask('Partida cerrada. ¿Qué más hay que hacer en ' + art(e) + '? Si ya has terminado aquí, di "siguiente estancia".', [{ label: 'Siguiente estancia', value: 'siguiente estancia' }, { label: 'Resumen de ' + e, value: 'qué llevo medido en ' + e }]);
        return this.ask('Partida cerrada. Dime el siguiente trabajo.', this.idleChips());
      }
      // Búsqueda forzada
      if ((m = text.match(/^(?:nueva partida|partida|busca|buscar|añade partida|anade partida)\s*:?\s+(.+)$/i))) return this.selectWork(m[1]);

      return false;
    }
    /** Desde un estado intermedio: ¿el usuario ha cambiado de tema? */
    escape(text, n) {
      if (!text) return false;
      const prev = this.state;
      this.state = { mode: 'idle' };
      if (this.tryCommands(text, n) !== false) return true;
      this.state = prev;
      return false;
    }
    looksLikeMeasure(pm, text, act) {
      if (pm.ded) return true;
      const content = contentWords(text);
      if (pm.count >= 2) return true;
      if (act.u === 'ud' || act.u === 'm' || !['m2', 'm3'].includes(act.u)) return content.length <= 4;
      return content.length <= 3;
    }
    handleAct(a) {
      if (a.estancia !== undefined) return this.st_estancia(a.estancia, norm(a.estancia));
    }

    /* ---- Selección de partida ---- */
    boostFn() {
      const kw = AMBITOS[this.obra.ambito] && AMBITOS[this.obra.ambito].kw;
      if (!kw) return null;
      return (d) => kw.test(norm(d.path || d.chapTitle || '')) ? 1.12 : 1;
    }
    selectWork(query) {
      const cat = this.cat;
      const res = cat.index.search(query, this.boostFn());
      const best = res.length ? res[0].s : 0;
      // Prioridad 1: ¿existe ya algo parecido en la obra?
      const op = this.obra.partidas;
      if (op.length) {
        const oidx = new Index(op.map((p) => ({ key: p.uid, r: p.r, t: p.t, subTitle: p.subTitle, path: p.chapTitle, chapTitle: p.chapTitle })));
        const ores = oidx.search(query);
        // Puntuación relativa contra el catálogo (si la partida viene del catálogo, usamos su score del catálogo)
        const scored = ores.map((o) => {
          const p = op.find((x) => x.uid === o.doc.key);
          const cs = p.ref && res.find((r) => r.doc.c === p.ref);
          return { p, s: Math.max(o.s * 0.9, cs ? cs.s : 0) };
        }).sort((a, b) => b.s - a.s);
        if (scored.length && scored[0].s >= 0.42 && scored[0].s >= best * 0.85) {
          const p = scored[0].p;
          const ests = [...new Set(p.lineas.map((l) => l.est).filter(Boolean))];
          const here = this.obra.estActiva;
          if (!p.lineas.length || !here || ests.includes(here) || !ests.length) {
            return this.activate(p, 'Continúo con la partida ' + p.r + '.', query);
          }
          this.state = { mode: 'reuse', p, query, exclude: [p.ref] };
          const donde = ests.length === 1 ? 'en ' + art(ests[0]) : 'en ' + ests.slice(0, -1).map(art).join(', ') + ' y ' + art(ests[ests.length - 1]);
          return this.ask('Ya tienes creada la partida ' + p.r + ' ' + donde + '. ¿La ponemos igual que ' + (ests.length === 1 ? 'en ' + art(ests[0]) : 'antes') + ' o quieres elegir otra distinta?',
            [{ label: 'Sí, igual', value: 'sí, igual', act: { reuse: true } }, { label: 'Otra distinta', value: 'otra distinta', act: { reuse: false } }]);
        }
      }
      return this.funnelStart(query, res, []);
    }
    st_reuse(text, n, input) {
      const st = this.state;
      let yes = null;
      if (input && input.act && input.act.reuse !== undefined) yes = input.act.reuse;
      else if (/^(si|igual|la misma|misma|vale|ok|correcto|eso|esa|de acuerdo)\b|igual/.test(n)) yes = true;
      else if (/^(no|otra|distinta|diferente|elegir|cambia)\b|otra distinta/.test(n)) yes = false;
      if (yes === null && this.escape(text, n)) return;
      if (yes === null) return this.ask('¿Igual que antes, o otra distinta?', this.lastPrompt.chips);
      if (yes) return this.activate(st.p, 'Perfecto, misma partida.', st.query);
      const res = this.cat.index.search(st.query, this.boostFn());
      return this.funnelStart(st.query, res, st.exclude.filter(Boolean));
    }
    funnelStart(query, res, exclude) {
      const best = res.length ? res[0].s : 0;
      if (best < 0.34) return this.createStart(query, res);
      let cands = res.filter((r) => r.s >= best * 0.8 && !exclude.includes(r.doc.c)).slice(0, 60);
      if (!cands.length) return this.createStart(query, res);
      cands = prefilter(cands, query);
      this.state = { mode: 'funnel', query, cands, asked: new Set(), all: res.filter((r) => r.s >= best * 0.55 && !exclude.includes(r.doc.c)).slice(0, 40) };
      return this.funnelStep();
    }
    funnelStep(prefix) {
      const st = this.state; const c = st.cands;
      prefix = prefix ? prefix + ' ' : '';
      if (c.length === 1) return this.pickDoc(c[0].doc, prefix, st.query);
      if (c.length <= 4) { const sh = shortLabels(c.map((x) => x.doc.r)); return this.askList(c, prefix + 'Tengo ' + c.length + ' opciones: ' + sh.map((x, i) => (i + 1) + ', ' + x).join('; ') + '. ¿Cuál?'); }
      const sp = bestSplit(c, st.asked);
      if (!sp) { const sh = shortLabels(c.slice(0, 4).map((x) => x.doc.r)); return this.askList(c.slice(0, 6), prefix + 'Hay ' + c.length + ' opciones parecidas. Te leo las más probables: ' + sh.map((x, i) => (i + 1) + ', ' + x).join('; ') + '. ¿Cuál?'); }
      st.split = sp; st.asked.add(sp.a.id);
      const opts = sp.opts.slice(0, 6);
      if (sp.nulls && opts.length < 7) opts.push('Otra / sin especificar');
      st.splitOpts = opts;
      const chips = opts.map((o, i) => ({ label: cap(o), value: o, act: { opt: i } }));
      chips.push({ label: 'Ver lista (' + c.length + ')', value: 'ver lista', act: { list: true } }, { label: 'Ninguna, crear nueva', value: 'ninguna', act: { create: true } });
      let q = sp.a.q(opts.map(cap));
      if (sp.a.id === 'sub' || sp.a.id === 'capitulo' || (sp.a.id === 'medios' && opts.length > 2)) q += ' ' + opts.slice(0, 5).map(cap).join(', ') + '.';
      this.ask(prefix + q, chips);
    }
    askList(c, text) {
      this.state.mode = 'list'; this.state.listed = c;
      const short = shortLabels(c.map((x) => x.doc.r));
      c.forEach((x, i) => { x.short = short[i]; });
      const chips = c.map((x, i) => ({ label: (i + 1) + '. ' + x.doc.r + ' (' + unitLabel(x.doc.u) + ')', value: x.doc.r, act: { pick: i } }));
      chips.push({ label: 'Ninguna, crear nueva', value: 'ninguna', act: { create: true } });
      this.ask(text, chips, { long: true });
    }
    st_funnel(text, n, input) {
      const st = this.state;
      const a = input && input.act;
      if (a && a.list) return this.askList(st.cands.slice(0, 12), 'Estas son las opciones. ¿Cuál?');
      if ((a && a.create) || /^(ninguna|ninguno|crear|crea|nueva|no esta|no es ninguna)/.test(n)) return this.createStart(st.query, []);
      if (/^(ver lista|lista|leeme|lee las opciones|cuales hay|todas)/.test(n)) return this.askList(st.cands.slice(0, 12), 'Estas son las opciones. ¿Cuál?');
      if (/^(me da igual|cualquiera|la normal|la habitual|la que sea)/.test(n)) return this.pickDoc(st.cands[0].doc, 'Pongo la más habitual.', st.query);
      if (!a) { const pm = parseMeasure(text); if (pm.count + (pm.n !== null ? 1 : 0) >= 2) return this.ask('Antes de medir necesito saber la partida. ' + st.split.a.q(st.splitOpts.map(cap)), this.lastPrompt.chips); }
      let i = a && a.opt !== undefined ? a.opt : matchOption(text, st.splitOpts);
      if (i < 0 && this.escape(text, n)) return;
      if (i < 0) {
        // ¿Ha nombrado directamente una partida o un valor de otro atributo?
        const f = prefilter(st.cands, text);
        if (f.length < st.cands.length && f.length) { st.cands = f; return this.funnelStep(); }
        if (!contentWords(text).length) return this.ask('No te he entendido. ' + st.split.a.q(st.splitOpts.map(cap)), this.lastPrompt.chips);
        const res = this.cat.index.search(st.query + ' ' + text, this.boostFn());
        const inC = res.filter((r) => st.cands.some((c) => c.doc.c === r.doc.c));
        if (inC.length && inC[0].s > (inC[1] ? inC[1].s * 1.15 : 0)) return this.pickDoc(inC[0].doc, '', st.query);
        if (contentWords(text).length >= 2 && res.length && res[0].s > 0.5 && !st.cands.some((c) => c.doc.c === res[0].doc.c)) return this.selectWork(text);
        return this.ask('No te he entendido. ' + st.split.a.q(st.splitOpts.map(cap)), this.lastPrompt.chips);
      }
      const val = st.splitOpts[i];
      const id = st.split.a.id;
      st.cands = st.cands.filter((c) => val === 'Otra / sin especificar' ? !c.doc.attrs[id] : c.doc.attrs[id] === val);
      this.funnelStep();
    }
    st_list(text, n, input) {
      const st = this.state; const a = input && input.act;
      if ((a && a.create) || /^(ninguna|ninguno|crear|crea|nueva|no esta)/.test(n)) return this.createStart(st.query, []);
      if (!a) { const pm = parseMeasure(text); if (pm.count >= 2 && !/\b(opcion|primera|segunda|tercera|cuarta|numero)\b/.test(n)) return this.ask('Antes de medir, elige la partida: dime el número de la opción.', this.lastPrompt.chips); }
      let i = a && a.pick !== undefined ? a.pick : matchOption(text, st.listed.map((x) => x.short || x.doc.r));
      if (i < 0) i = matchOption(text, st.listed.map((x) => x.doc.r));
      if (i < 0 && this.escape(text, n)) return;
      if (i < 0) {
        const res = this.cat.index.search(text, this.boostFn());
        if (contentWords(text).length >= 2 && res.length && res[0].s > 0.5 && !st.listed.some((c) => c.doc.c === res[0].doc.c)) return this.selectWork(text);
        const f = prefilter(st.listed, text);
        if (f.length === 1) return this.pickDoc(f[0].doc, '', st.query);
        if (f.length > 1 && f.length < st.listed.length) return this.askList(f, 'Quedan ' + f.length + ': ' + f.map((x, j) => (j + 1) + ', ' + x.doc.r).join('; ') + '. ¿Cuál?');
        return this.ask('¿Cuál de ellas? Dime el número.', this.lastPrompt.chips);
      }
      this.pickDoc(st.listed[i].doc, '', st.query);
    }
    /** Crea (o reutiliza) la partida del catálogo en la obra y la activa. */
    pickDoc(d, prefix, query) {
      let p = this.obra.partidas.find((x) => x.ref === d.c);
      if (!p) {
        this.snapshot();
        p = {
          uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ref: d.c, u: d.u, r: d.r, t: d.t,
          chap: d.chap, chapTitle: d.chapTitle, chapOrder: d.chapOrder, subTitle: d.subTitle, lineas: [], creada: Date.now()
        };
        p.orient = orientOf(p);
        this.obra.partidas.push(p);
      }
      return this.activate(p, (prefix || '') + 'Partida ' + p.r + ', en ' + unitSpoken(p.u) + '.', query);
    }
    activate(p, msg, query) {
      this.obra.activa = p.uid; p.mod = Date.now();
      if (query) this.lastQuery = query;
      this.state = { mode: 'idle' };
      this.touch();
      // Herencia proactiva
      const sug = this.inheritSuggestion(p, query);
      if (sug) return sug(msg);
      this.ask(msg + ' ' + dimsSpec(p).ask, this.idleChips());
    }

    /* ---- Herencia ---- */
    inheritSuggestion(p, query) {
      if (!['m2'].includes(p.u)) return null;
      const g = inheritGroup(p, query);
      if (!g) return null;
      const DEM = /demolic|levantado|desmontaje|picado|arranque/;
      const src = this.obra.partidas.filter((x) => x.uid !== p.uid && x.u === 'm2' && x.lineas.some((l) => lineGroup(x, l) === g && (l.uds || 1) > 0));
      if (!src.length) return null;
      // Mejor fuente: mismo carácter (obra nueva vs demolición) y con más líneas
      const same = (x) => (DEM.test(norm(x.r)) === DEM.test(norm(p.r)) ? 1000 : 0);
      const cnt = (x) => x.lineas.filter((l) => lineGroup(x, l) === g).length;
      src.sort((a, b) => same(b) + cnt(b) - (same(a) + cnt(a)));
      const s = src[0];
      const already = p.lineas.some((l) => l.from === s.uid);
      if (already) return null;
      const gl = s.lineas.filter((l) => lineGroup(s, l) === g);
      const ests = [...new Set(gl.map((l) => l.est).filter(Boolean))];
      const tot = round2(gl.reduce((a, l) => a + parcial(l), 0));
      const nombreG = g === 'H' ? (/techo/.test(norm(s.r)) ? 'techo' : 'suelo') : 'paredes';
      const destino = g === 'H' ? (/techo|cielo/.test(norm(p.r + ' ' + (query || ''))) ? 'al techo' : 'al suelo') : 'a las paredes';
      return (msg) => {
        this.state = { mode: 'inherit', p, s, query, g, toTecho: destino === 'al techo' };
        this.ask(msg + ' Veo que ya tienes medidos ' + fmt(tot) + ' metros cuadrados de ' + nombreG + ' en ' + (ests.length || 1) + (ests.length === 1 ? ' estancia' : ' estancias') + ' (' + s.r + '). ¿Aplico esas mismas superficies ' + destino + ' o las medimos aparte?',
          [{ label: 'Sí, aplicar todas', value: 'sí, aplica', act: { inh: 'all' } },
            ...(this.obra.estActiva && ests.includes(this.obra.estActiva) ? [{ label: 'Solo ' + this.obra.estActiva, value: 'solo ' + this.obra.estActiva, act: { inh: 'est' } }] : []),
            { label: 'Medir aparte', value: 'medir aparte', act: { inh: 'no' } }]);
      };
    }
    st_inherit(text, n, input) {
      const st = this.state; const a = input && input.act;
      let mode = a && a.inh;
      if (!mode) {
        if (/^(no|aparte|medir aparte|medimos aparte|mejor no)\b/.test(n)) mode = 'no';
        else if (/solo|esta estancia|aqui/.test(n)) mode = 'est';
        else if (/^(si|vale|aplica|ok|todas|de acuerdo|claro|venga)\b/.test(n)) mode = 'all';
      }
      if (!mode && this.escape(text, n)) return;
      if (!mode) { const pm = parseMeasure(text); if (pm.count >= 1 && this.looksLikeMeasure(pm, text, st.p)) { this.state = { mode: 'idle' }; return this.addMeasure(pm, text); } }
      if (!mode) return this.ask('¿Aplico las mismas superficies o medimos aparte?', this.lastPrompt.chips);
      this.state = { mode: 'idle' };
      if (mode === 'no') return this.ask('De acuerdo, medimos aparte. ' + dimsSpec(st.p).ask, this.idleChips());
      const est = mode === 'est' ? this.obra.estActiva : null;
      const nl = this.copyLines(st.s, st.p, { est, g: st.g, com: st.toTecho && /pintura|revestimiento|yeso|enlucido|guarnecido/.test(norm(st.p.r)) ? 'Techo' : null });
      this.ask('Copiadas ' + nl + (nl === 1 ? ' línea' : ' líneas') + '. Total ' + fmt(totalOf(st.p)) + ' ' + unitSpoken(st.p.u) + '. ¿Algo más en esta partida?', this.idleChips());
    }
    copyLines(src, dst, opt) {
      opt = opt || {};
      this.snapshot();
      let k = 0;
      for (const l of src.lineas) {
        if (opt.est && norm(l.est || '') !== norm(opt.est)) continue;
        if (opt.positiveOnly && (l.uds || 1) < 0) continue;
        if (opt.g && lineGroup(src, l) !== opt.g) continue;
        const nl = { id: this.nextId(dst), est: l.est, com: opt.com ? (l.com ? opt.com + ' - ' + l.com : opt.com) : l.com, uds: l.uds, l: l.l, a: null, h: null, from: src.uid };
        const lg = opt.com === 'Techo' ? 'H' : lineGroup(src, l); if (lg) nl.grp = lg;
        const second = l.a !== null && l.a !== undefined ? l.a : l.h;
        if (dst.u === 'm2') { const og = nl.grp || null; if (og === 'H' || (!og && dst.orient !== 'V')) nl.a = second; else nl.h = second; }
        else if (dst.u === 'm3') { nl.a = l.a; nl.h = l.h; }
        else if (dst.u === 'm') { /* solo largo */ }
        if (dst.u === 'ud') { nl.l = null; }
        dst.lineas.push(nl); k++;
      }
      dst.mod = Date.now();
      this.touch();
      return k;
    }
    findObraPartida(text, filter) {
      const list = this.obra.partidas.filter((p) => p.lineas.length && (!filter || filter(p)));
      if (!list.length) return null;
      const idx = new Index(list.map((p) => ({ key: p.uid, r: p.r, t: p.t, subTitle: p.subTitle, path: p.chapTitle })));
      const r = idx.search(text);
      if (r.length && r[0].s > 0.25) return list.find((p) => p.uid === r[0].doc.key);
      // por grupo (suelo/techo/paredes)
      const g = /suelo|pavimento|solado|techo/.test(norm(text)) ? 'H' : /pared|paramento|enlucido|guarnecido/.test(norm(text)) ? 'V' : null;
      if (g) return list.find((p) => inheritGroup(p) === g) || null;
      return null;
    }
    cmdCopyFrom(text) {
      const dst = this.active();
      if (!dst) return this.ask('Primero dime la partida a la que copio las medidas.');
      const src = this.findObraPartida(text, (p) => p.uid !== dst.uid);
      if (!src) return this.ask('No encuentro en la obra una partida medida que se parezca a "' + text + '".');
      const k = this.copyLines(src, dst, {});
      if (k === 1) return this.ask('Copiada 1 línea de ' + src.r + '. Total ' + fmt(totalOf(dst)) + ' ' + unitSpoken(dst.u) + '.', this.idleChips());
      this.ask('Copiadas ' + k + ' líneas de ' + src.r + '. Total ' + fmt(totalOf(dst)) + ' ' + unitSpoken(dst.u) + '.', this.idleChips());
    }
    cmdCopyRoom(what, room, huecos) {
      const dst = this.active();
      if (!dst) return this.ask('Primero dime la partida destino.');
      const est = matchEstancia(estanciaName(room), this.obra.estancias || []);
      const g = /suelo|techo/.test(what) ? 'H' : /pared|paramento/.test(what) ? 'V' : null;
      const cands = this.obra.partidas.filter((p) => p.uid !== dst.uid && p.lineas.some((l) => norm(l.est || '') === norm(est) && (!g || lineGroup(p, l) === g)));
      if (!cands.length) return this.ask('No tengo ' + what + ' medidas en ' + art(est) + '.');
      cands.sort((a, b) => b.lineas.filter((l) => norm(l.est || '') === norm(est)).length - a.lineas.filter((l) => norm(l.est || '') === norm(est)).length);
      const src = cands[0];
      let k = this.copyLines(src, dst, { est, positiveOnly: !!huecos, g });
      let msg = (k === 1 ? 'Copiada 1 línea ' : 'Copiadas ' + k + ' líneas ') + deArt(est) + ' desde ' + src.r + '.';
      if (huecos) {
        const kind = /puerta/.test(huecos) ? /puerta|block/ : /ventana/.test(huecos) ? /ventana|balconera|ventanal/ : /ventana|puerta|balconera|ventanal|block|hueco/;
        const hs = [];
        this.obra.partidas.forEach((p) => {
          if (!kind.test(norm(p.r))) return;
          p.lineas.forEach((l) => { if (norm(l.est || '') !== norm(est)) return; const a = l.hueco ? l.hueco.a : l.l, h = l.hueco ? l.hueco.h : (l.h || l.a); if (a && h) hs.push({ n: Math.abs(l.uds || 1), a, h, com: l.com || p.r }); });
        });
        // también deducciones que tuviera la fuente original
        src.lineas.forEach((l) => { if (norm(l.est || '') === norm(est) && (l.uds || 1) < 0 && kind.test(norm(l.com || ''))) hs.push({ n: Math.abs(l.uds), a: l.l, h: l.h || l.a, com: (l.com || '').replace(/^deducci[oó]n\s*/i, '') }); });
        if (!hs.length) msg += ' No encuentro ' + huecos + ' medidas en ' + art(est) + ' para descontar.';
        else {
          hs.forEach((x) => {
            const nl = { id: this.nextId(dst), est, com: 'Deducción ' + (x.com || huecos), uds: -x.n, l: x.a, a: null, h: null };
            if (dst.orient === 'V') nl.h = x.h; else nl.a = x.h;
            dst.lineas.push(nl);
          });
          this.touch();
          msg += ' Descontados ' + hs.length + ' huecos.';
        }
      }
      this.ask(msg + ' Total ' + fmt(totalOf(dst)) + ' ' + unitSpoken(dst.u) + '.', this.idleChips());
    }

    /* ---- Creación de partida propia ---- */
    createStart(query, res) {
      this.state = { mode: 'create_unit', query, guess: res && res.length ? res[0].doc : null };
      this.ask('No encuentro esa partida en la base de datos. Vamos a crearla. ¿En qué unidad se mide? Unidades, metros, metros cuadrados o metros cúbicos.',
        [{ label: 'ud', value: 'unidades', act: { u: 'ud' } }, { label: 'm', value: 'metros', act: { u: 'm' } }, { label: 'm²', value: 'metros cuadrados', act: { u: 'm2' } }, { label: 'm³', value: 'metros cúbicos', act: { u: 'm3' } }]);
    }
    st_create_unit(text, n, input) {
      let u = input && input.act && input.act.u;
      if (!u) {
        if (/cuadrad|m2|superficie/.test(n)) u = 'm2';
        else if (/cubic|m3|volumen/.test(n)) u = 'm3';
        else if (/unidad|^ud|^uds|piezas|^u$/.test(n)) u = 'ud';
        else if (/metro|lineal|^m$|^ml$/.test(n)) u = 'm';
      }
      if (!u && this.escape(text, n)) return;
      if (!u) return this.ask('¿Unidades, metros, metros cuadrados o metros cúbicos?', this.lastPrompt.chips);
      this.state.u = u; this.state.mode = 'create_desc';
      const q = cap(this.state.query);
      this.ask('Dicta una breve descripción, o pulsa usar "' + q + '".', [{ label: 'Usar «' + q + '»', value: q, act: { useq: true } }]);
    }
    st_create_desc(text, n, input) {
      const st = this.state;
      const desc = cap(input && input.act && input.act.useq ? st.query : text);
      if (!desc) return;
      this.obra.propiaSeq = (this.obra.propiaSeq || 0) + 1;
      const code = 'PROPIA.' + String(this.obra.propiaSeq).padStart(3, '0');
      // Capítulo: el de la partida del catálogo más parecida (aunque no llegue al umbral)
      const res = this.cat.index.search(st.query + ' ' + desc, this.boostFn());
      const g = res.length && res[0].s > 0.12 ? res[0].doc : null;
      this.snapshot();
      const p = {
        uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ref: code, propia: true, u: st.u, r: desc, t: desc,
        chap: g ? g.chap : 'PROPIAS', chapTitle: g ? g.chapTitle : 'PARTIDAS PROPIAS', chapOrder: g ? g.chapOrder : 9999, subTitle: g ? g.subTitle : '', lineas: [], creada: Date.now()
      };
      p.orient = orientOf(p);
      this.obra.partidas.push(p);
      this.activate(p, 'Creada la partida ' + code + ', ' + desc + ', en el capítulo ' + p.chapTitle.toLowerCase() + '.', st.query);
    }

    /* ---- Mediciones ---- */
    nextId(p) { return p.lineas.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1; }
    addMeasure(pm, text) {
      const p = this.active();
      const pend = this.state.pending && this.state.pending.uid === p.uid ? this.state.pending : null;
      const r = buildLine(p, pm, pend ? pend.line : null);
      if (r.missing) {
        if (r.missing[0] === 'n') return this.ask('¿Cuántas unidades?');
        this.state = { mode: 'idle', pending: { uid: p.uid, line: r.pending, com: pm.comment || (pend && pend.com) || '', ded: pm.ded || (pend && pend.ded) } };
        return this.ask('Me falta ' + r.missing.map((k) => DIM_NAME[k]).join(' y ') + '.');
      }
      const line = r.line;
      const com = pm.comment || (pend && pend.com) || '';
      const ded = pm.ded || (pend && pend.ded);
      if (ded) line.uds = -Math.abs(line.uds || 1);
      this.snapshot();
      const nl = { id: this.nextId(p), est: this.estPrefix(), com: ded ? cap('Deducción ' + (com ? com.toLowerCase() : 'hueco')) : com, uds: line.uds, l: line.l, a: line.a, h: line.h };
      if (pm.orientHint && p.u === 'm2') nl.grp = pm.orientHint;
      if (line.hueco) { nl.hueco = line.hueco; if (!nl.com) nl.com = fmt(line.hueco.a) + ' x ' + fmt(line.hueco.h); else nl.com += ' ' + fmt(line.hueco.a) + ' x ' + fmt(line.hueco.h); }
      p.lineas.push(nl); p.mod = Date.now();
      this.state = { mode: 'idle' };
      this.touch();
      const parts = [];
      if (r.warn && r.warn.length) parts.push(r.warn.join(' '));
      parts.push((ded ? 'Descontados ' : 'Anotado ') + fmt(Math.abs(parcial(nl))) + '.');
      parts.push('Total ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '.');
      const nEst = p.lineas.filter((l) => (l.est || '') === this.estPrefix()).length;
      parts.push(nEst === 1 ? 'Dime la siguiente medida, un hueco a descontar, o di "siguiente partida".' : '¿Otra medida?');
      this.io.flash && this.io.flash(ded ? 'ded' : 'ok');
      this.ask(parts.join(' '), this.idleChips(), { short: true });
    }
    reviewLast() {
      const ps = this.obra.partidas.filter((p) => p.lineas.length).sort((a, b) => (b.mod || 0) - (a.mod || 0));
      if (!ps.length) return this.ask('Todavía no hay partidas medidas.');
      const p = ps[0];
      this.obra.activa = p.uid; this.touch();
      this.ask('Última partida: ' + p.r + '. ' + p.lineas.length + (p.lineas.length === 1 ? ' línea' : ' líneas') + ', total ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '.', this.idleChips());
    }
    readLines() {
      const p = this.active();
      if (!p) return this.ask('No hay partida activa.');
      if (!p.lineas.length) return this.ask('La partida ' + p.r + ' no tiene líneas todavía. ' + dimsSpec(p).ask);
      const txt = p.lineas.map((l, i) => {
        const dims = ['l', 'a', 'h'].filter((k) => l[k] !== null && l[k] !== undefined).map((k) => fmt(l[k])).join(' por ');
        const u = l.uds !== null && l.uds !== 1 ? (l.uds < 0 ? 'menos ' + fmtUds(Math.abs(l.uds)) : fmtUds(l.uds)) + (dims ? ' de ' : ' unidades') : '';
        return 'Línea ' + (i + 1) + ', ' + [l.est, l.com].filter(Boolean).join(' ') + ': ' + u + dims + ', parcial ' + fmt(parcial(l));
      }).join('. ');
      this.ask(txt + '. Total ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '.', this.idleChips(), { long: true });
    }
    deleteLine(i) {
      const p = this.active();
      if (!p || !p.lineas.length) return this.ask('No hay líneas que borrar.');
      const idx = i === null ? -9 : i < 0 ? p.lineas.length + i : i - 1;
      if (idx < 0 || idx >= p.lineas.length) return this.ask('No existe esa línea. Hay ' + p.lineas.length + '.');
      this.snapshot();
      const [l] = p.lineas.splice(idx, 1);
      this.touch();
      this.ask('Borrada la línea ' + (idx + 1) + (l.com ? ', ' + l.com : '') + '. Total ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '.', this.idleChips());
    }
    editLineField(i, field, valueText) {
      const p = this.active();
      if (!p || !p.lineas.length) return this.ask('No hay líneas que modificar.');
      const idx = i === null ? -9 : i < 0 ? p.lineas.length + i : i - 1;
      const l = p.lineas[idx];
      if (!l) return this.ask('No existe la línea ' + i + '.');
      const k = { largo: 'l', longitud: 'l', ancho: 'a', anchura: 'a', alto: 'h', altura: 'h', espesor: 'h', unidades: 'uds', uds: 'uds', comentario: 'com' }[field];
      this.snapshot();
      if (k === 'com') l.com = cap(valueText);
      else {
        const v = parseNumber(valueText);
        if (v === null) return this.ask('No he entendido el valor.');
        if (k === 'a' && l.a === null && l.h !== null && p.u === 'm2') l.h = v; // en paramentos "ancho" = segunda medida
        else if (k === 'h' && l.h === null && l.a !== null && p.u === 'm2') l.a = v;
        else l[k] = v;
      }
      this.touch();
      this.ask('Línea ' + (idx + 1) + ' corregida, parcial ' + fmt(parcial(l)) + '. Total ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '.', this.idleChips());
    }
    replaceLine(i, text) {
      const p = this.active();
      if (!p || !p.lineas.length) return this.ask('No hay líneas que modificar.');
      const idx = i === null ? -9 : i < 0 ? p.lineas.length + i : i - 1;
      const old = p.lineas[idx];
      if (!old) return this.ask('No existe esa línea.');
      const r = buildLine(p, parseMeasure(text));
      if (r.missing) return this.ask('Me falta ' + r.missing.map((k) => DIM_NAME[k] || 'la cantidad').join(' y ') + '.');
      this.snapshot();
      Object.assign(old, { uds: (old.uds < 0 ? -Math.abs(r.line.uds) : r.line.uds), l: r.line.l, a: r.line.a, h: r.line.h });
      this.touch();
      this.ask('Línea ' + (idx + 1) + ' cambiada, parcial ' + fmt(parcial(old)) + '. Total ' + fmt(totalOf(p)) + '.', this.idleChips());
    }
    confirmDeletePartida() {
      const p = this.active();
      if (!p) return this.ask('No hay partida activa.');
      this.state = { mode: 'confirm_del', p };
      this.ask('¿Seguro que borro la partida ' + p.r + ' con ' + p.lineas.length + ' líneas?', [{ label: 'Sí, borrar', value: 'sí', act: { yes: true } }, { label: 'No', value: 'no', act: { yes: false } }]);
    }
    st_confirm_del(text, n, input) {
      const yes = input && input.act ? input.act.yes : /^(si|borra|vale|ok)\b/.test(n);
      const p = this.state.p; this.state = { mode: 'idle' };
      if (!yes) return this.ask('No la borro.', this.idleChips());
      this.snapshot();
      this.obra.partidas = this.obra.partidas.filter((x) => x.uid !== p.uid);
      this.obra.activa = null; this.touch();
      this.ask('Partida borrada. Puedes decir "deshacer".');
    }
    summaryEstancia(raw) {
      const est = matchEstancia(estanciaName(raw), this.obra.estancias || []);
      const ps = this.obra.partidas.filter((p) => p.lineas.some((l) => norm(l.est || '') === norm(est)));
      this.io.filterEstancia && this.io.filterEstancia(est);
      if (!ps.length) return this.ask('En ' + art(est) + ' no hay nada medido todavía.');
      const parts = ps.map((p) => { const t = round2(p.lineas.filter((l) => norm(l.est || '') === norm(est)).reduce((a, l) => a + parcial(l), 0)); return p.r + ', ' + fmt(t) + ' ' + unitSpoken(p.u); });
      this.ask('En ' + art(est) + ' llevas ' + ps.length + (ps.length === 1 ? ' partida: ' : ' partidas: ') + parts.join('; ') + '.', this.idleChips(), { long: true });
    }
    summaryObra() {
      const ps = this.obra.partidas.filter((p) => p.lineas.length);
      const nl = ps.reduce((a, p) => a + p.lineas.length, 0);
      this.ask('La obra lleva ' + ps.length + ' partidas medidas y ' + nl + ' líneas, en ' + (this.obra.estancias || []).length + ' estancias.', this.idleChips());
    }
  }
  /** Quita las palabras comunes al principio/final para leer solo lo que diferencia las opciones. */
  function shortLabels(list) {
    if (list.length < 2) return list.slice();
    const toks = list.map((r) => r.split(/\s+/));
    let pre = 0;
    while (toks.every((t) => t.length > pre + 1 && norm(t[pre]) === norm(toks[0][pre]))) pre++;
    let suf = 0;
    while (toks.every((t) => t.length > pre + suf + 1 && norm(t[t.length - 1 - suf]) === norm(toks[0][toks[0].length - 1 - suf]))) suf++;
    if (pre < 2 && suf < 2) return list.slice();
    return toks.map((t) => { let x = t.slice(pre, t.length - suf); while (x.length > 1 && /^(de|del|con|y|en|,)$/i.test(x[0])) x = x.slice(1); return x.join(' ').replace(/[,;]$/, ''); });
  }
  function lineGroup(p, l) { return l.grp || (l.com && /techo/i.test(l.com) ? 'H' : null) || inheritGroup(p); }
  function deArt(est) { const a = art(est); return a.startsWith('el ') ? 'del ' + a.slice(3) : 'de ' + a; }
  function art(est) {
    const n = norm(est);
    if (/^(cocina|terraza|galeria|entrada|habitacion|escalera|azotea|cubierta|fachada|despensa|zona|planta|oficina|sala|suite|bodega|tienda|nave|piscina)/.test(n)) return 'la ' + est.toLowerCase().replace(/^\w/, (c) => c);
    return 'el ' + est.toLowerCase();
  }

  /* ---------------- Numeración de obra (01, 01.01…) ---------------- */
  function obraChapters(obra) {
    const map = new Map();
    obra.partidas.forEach((p) => {
      if (!map.has(p.chap)) map.set(p.chap, { chap: p.chap, titulo: p.chapTitle, order: p.chapOrder ?? 9999, partidas: [] });
      map.get(p.chap).partidas.push(p);
    });
    const caps = [...map.values()].sort((a, b) => a.order - b.order || a.titulo.localeCompare(b.titulo));
    caps.forEach((c, i) => {
      c.codigo = String(i + 1).padStart(2, '0');
      c.partidas.sort((a, b) => (a.creada || 0) - (b.creada || 0));
      c.partidas.forEach((p, j) => { p.codigo = c.codigo + '.' + String(j + 1).padStart(2, '0'); });
    });
    return caps;
  }

  const api = { norm, words, stem, tokenize, parseMeasure, parseNumber, parseIndex, Index, prepareCatalog, bestSplit, prefilter, matchOption, orientOf, dimsSpec, buildLine, parcial, totalOf, inheritGroup, estanciaName, matchEstancia, ambitoFromText, Dialog, obraChapters, fmt, fmtUds, unitLabel, unitSpoken, AMBITOS, DEFAULT_ESTANCIAS, isCarpinteria, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);

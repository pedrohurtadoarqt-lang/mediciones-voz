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
          if (n1 === 'y' && j + 2 < raw.length && norm(raw[j + 2]) in NUMW && v % 10 === 0 && v >= 30 && v < 100 && NUMW[norm(raw[j + 2])] < 10 && !(j + 3 < raw.length && (norm(raw[j + 3]) in NUMW || /^\d/.test(raw[j + 3])))) {
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
        const d3 = t1[i + 3];
        if (b && b.k === 'W' && /^(metros?|m)$/.test(b.n) && c && c.k === 'N' && !c.dec && c.v < 100 && d3 && d3.k === 'W' && /^(centimetros?|cm|cms)$/.test(d3.n)) {
          t2.push({ k: 'N', v: a.v + c.v / 100, dec: true, unit: 'm', orig: a.orig + ' m ' + c.orig + ' cm' }); i += 3; continue;
        }
        if (b && b.k === 'W' && /^(metros?|m)$/.test(b.n) && c && c.k === 'N' && !c.dec && c.v < 100 && !(t1[i + 3] && t1[i + 3].k === 'W' && /^(metros?|m|centimetros?|cm)$/.test(t1[i + 3].n)) && !(t1[i + 3] && t1[i + 3].k === 'W' && t1[i + 3].n === 'de')) {
          t2.push({ k: 'N', v: a.v + c.v / Math.pow(10, c.str.length), dec: true, unit: 'm', orig: a.orig + ' m ' + c.orig }); i += 2; continue;
        }
      }
      if (a.k === 'N' && !a.dec && t1[i + 1] && t1[i + 1].k === 'W' && t1[i + 1].n === 'y' && t1[i + 2] && t1[i + 2].k === 'W' && /^medi[oa]$/.test(t1[i + 2].n)) {
        t2.push({ k: 'N', v: a.v + 0.5, dec: true, orig: a.orig + ' y medio' }); i += 2; continue;
      }
      if (a.k === 'N') {
        const b = t1[i + 1];
        if (b && b.k === 'W' && /^(centimetros?|cm|cms)$/.test(b.n)) { t2.push({ k: 'N', v: a.v / 100, dec: true, unit: 'cm', orig: a.orig + ' cm' }); i++; continue; }
        if (b && b.k === 'W' && /^(milimetros?|mm)$/.test(b.n)) { t2.push({ k: 'N', v: a.v / 1000, dec: true, unit: 'mm', orig: a.orig + ' mm' }); i++; continue; }
        if (b && b.k === 'W' && /^(metros?|m|mts)$/.test(b.n)) { t2.push(Object.assign({}, a, { unit: 'm' })); i++; continue; }
      }
      t2.push(a);
    }
    // Si la unidad se dice una sola vez ("340 por 250 centímetros"), vale para todos los números sin unidad
    const units = new Set(t2.filter((x) => x.k === 'N' && x.unit).map((x) => x.unit));
    if (units.size === 1 && (units.has('cm') || units.has('mm'))) {
      const f = units.has('cm') ? 100 : 1000;
      t2.forEach((x) => { if (x.k === 'N' && !x.unit && !x.art && !x.dec && x.v >= (f === 100 ? 10 : 100)) { x.v = x.v / f; x.unit = units.has('cm') ? 'cm' : 'mm'; x.dec = true; x.conv = true; } });
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
  const DEDUC_ANY = /\b(descuenta|descontar|descontando|deduce|deduciendo|deduccion|resta|restando|menos|quita|quitando)\b/;
  const NWORDS = /^(unidades|unidad|uds|ud|veces|tramos|tramo|iguales|piezas|puntos)$/;

  /**
   * Analiza un dictado de medición.
   * Devuelve { n (uds explícitas o null), dims:[...], labeled:{l,a,h}, ded, comment, nums }
   */
  function parseMeasure(text) {
    const tk = tokenize(text);
    const res = { n: null, dims: [], labeled: {}, ded: false, comment: '', count: 0, orientHint: null, cm: tk.some((x) => x.k === 'N' && (x.unit === 'cm' || x.unit === 'mm')), metros: tk.some((x) => x.k === 'N' && x.unit === 'm') };
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
    { id: 'orient', p: 1.0, q: () => '¿Es en paredes o en techo?', src: 'r', vals: [['vertical', /vertical|pared|paramento/], ['horizontal', /horizontal|techo|cielo/]] },
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
    picado: 'demolicion picado levantado eliminacion', picar: 'demolicion picado eliminacion', pica: 'demolicion picado eliminacion', eliminar: 'eliminacion demolicion', rascar: 'eliminacion rascado', lijar: 'lijado',
    quitar: 'demolicion desmontaje levantado arranque eliminacion', retirar: 'demolicion desmontaje levantado retirada', arrancar: 'demolicion arranque levantado',
    tirar: 'demolicion derribo', derribar: 'demolicion derribo', demoler: 'demolicion', derribo: 'demolicion derribo', desmontar: 'desmontaje', levantar: 'levantado demolicion desmontaje', demolicion: 'demolicion levantado desmontaje eliminacion arranque', demoler: 'demolicion levantado',
    azulejo: 'alicatado azulejo', azulejos: 'alicatado azulejo', alicatar: 'alicatado', alicatados: 'alicatado', baldosa: 'baldosa solado pavimento', baldosas: 'baldosa solado pavimento',
    suelo: 'suelo solado pavimento entarimado', suelos: 'suelo solado pavimento entarimado', pavimento: 'pavimento solado entarimado suelo', pavimentos: 'pavimento solado entarimado suelo', solar: 'solado pavimento', solado: 'solado pavimento',
    pintar: 'pintura', pinto: 'pintura', pared: 'paramento pared vertical', paredes: 'paramento pared vertical',
    techo: 'techo horizontal', techos: 'techo horizontal', pladur: 'yeso laminado placa', escayola: 'escayola', yeso: 'yeso guarnecido enlucido',
    enlucir: 'enlucido', enlucido: 'enlucido guarnecido', guarnecer: 'guarnecido', enfoscar: 'enfoscado', revocar: 'revoco', tabicar: 'tabique tabiqueria', tabique: 'tabique tabiqueria',
    enchufe: 'toma de corriente', enchufes: 'toma de corriente', interruptor: 'interruptor', luz: 'luz alumbrado', luces: 'luz alumbrado',
    grifo: 'griferia grifo', grifos: 'griferia grifo', vater: 'inodoro', water: 'inodoro', wc: 'inodoro', retrete: 'inodoro', vateres: 'inodoro',
    ducha: 'ducha plato', banera: 'banera', termo: 'termo acumulador calentador', calentador: 'calentador acumulador', radiador: 'radiador emisor',
    split: 'split aire acondicionado', aire: 'aire acondicionado split', clima: 'climatizacion aire acondicionado', climatizacion: 'climatizacion aire',
    cristal: 'vidrio acristalamiento', cristales: 'vidrio acristalamiento', escombro: 'residuo escombro contenedor', escombros: 'residuo escombro contenedor',
    impermeabilizar: 'impermeabilizacion', aislar: 'aislamiento', roza: 'roza', rozas: 'roza', regata: 'roza', regatas: 'roza',
    zocalo: 'rodapie zocalo', rodapie: 'rodapie', tarima: 'tarima entarimado madera parquet', parquet: 'parquet tarima entarimado pavimento laminado', parket: 'parquet tarima entarimado pavimento laminado', parque: 'parquet tarima entarimado', entarimado: 'entarimado tarima parquet',  tarimas: 'tarima entarimado', barandilla: 'barandilla', reja: 'reja cerrajeria',
    canalon: 'canalon', bajante: 'bajante', desague: 'desague evacuacion', tuberia: 'tuberia tubo', tuberias: 'tuberia tubo', cable: 'cable conductor circuito', cableado: 'cable conductor circuito',
    ventana: 'ventana carpinteria', ventanas: 'ventana carpinteria', puerta: 'puerta block carpinteria', puertas: 'puerta block carpinteria',
    hormigonar: 'hormigon', solera: 'solera', fachada: 'fachada', tejado: 'cubierta teja', tejas: 'teja cubierta', mampara: 'mampara',
    fregadero: 'fregadero', encimera: 'encimera', muebles: 'mueble', mueble: 'mueble', lavabo: 'lavabo', bide: 'bide', plato: 'plato ducha'
  };
  const SYN = {};
  // Cada sinónimo es una palabra o frase: 'yeso laminado' exige ambas palabras.
  const PHRASES = { 'pavimento laminado': 1, 'toma de corriente': 1, 'yeso laminado': 1, 'aire acondicionado': 1, 'punto de luz': 1, 'falso techo': 1, 'plato ducha': 1 };
  for (const k in SYN_RAW) {
    const raw = SYN_RAW[k]; const out = []; let rest = ' ' + raw + ' ';
    Object.keys(PHRASES).forEach((ph) => { if (rest.includes(' ' + ph + ' ')) { out.push(words(ph).filter((w) => !STOP.has(w)).map(stem)); rest = rest.replace(' ' + ph + ' ', ' '); } });
    rest.trim().split(/\s+/).filter(Boolean).forEach((w) => out.push([stem(norm(w))]));
    SYN[stem(norm(k))] = out;
  }

  // Palabras de contexto que no tienen por qué aparecer en el resumen de la partida
  const COVER_IGNORE = new Set(('techo techos suelo suelos pared paredes paramento paramentos interior exterior cocina bano aseo salon comedor dormitorio habitacion pasillo terraza ' +
    'toda todo zona estancia obra casa piso vivienda metro metros cuadrado cuadrados lineal lineales unidad unidades mismo misma medida medidas nueva nuevo hacer poner quitar ' +
    'tipo normal general completo completa tambien').split(' ').map((w) => stem(w)));
  const DEM_Q = /\b(demol|derrib|tirar|quitar|quita|retirar|retira|retirada|levantar|levantado|arrancar|arranque|picar|picado|pica|eliminar|eliminacion|desmontar|desmontaje|rascar|rascado|decapar|decapado|vaciar|vaciado de)/;
  const DEM_DOC = /\b(demolicion|derribo|levantado|desmontaje|eliminacion|arranque|picado|rascado|decapado|retirada|demolido|vaciado de|corte de)/;
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
          else if (v.length >= 6 && t[0] === v[0] && lev1(t, v)) res.push({ stem: t, q: 0.7 });
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
        const strong = new Set(); // docs donde el término está en el resumen o subcapítulo
        for (const v of this.variants(w)) {
          const maps = v.ph.map((x) => this.termMap(x));
          for (const [di, sc0] of maps[0]) {
            let sc = sc0;
            for (let k = 1; k < maps.length && sc > 0; k++) sc = Math.min(sc, maps[k].get(di) || 0);
            if (sc >= 0.56) strong.add(di);
            sc *= v.w;
            if (sc > 0 && (acc.get(di) || 0) < sc) acc.set(di, sc);
          }
        }
        const key = !COVER_IGNORE.has(stem(w)) && !/^\d/.test(w);
        const df = acc.size;
        const imp = df === 0 ? 0.25 : Math.log(1 + this.N / df);
        return { acc, imp, strong, key };
      });
      const nKey = perTerm.filter((t) => t.key).length;
      const totImp = perTerm.reduce((a, b) => a + b.imp, 0);
      const scores = new Map();
      perTerm.forEach(({ acc, imp }) => {
        for (const [di, sc] of acc) scores.set(di, (scores.get(di) || 0) + sc * imp);
      });
      const out = [];
      for (const [di, sc] of scores) {
        let s = sc / totImp;
        if (boost) s *= boost(this.docs[di]);
        const miss = perTerm.filter((t) => t.key && !t.strong.has(di)).length;
        out.push({ i: di, doc: this.docs[di], s, miss, nKey });
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
  const RE_H = /\b(moqueta|linoleo|vinilico|baldosa|terrazo|suelo|solado|pavimento|solera|techo|falso techo|forjado|cubierta|horizontal|cielo raso|tarima|parquet|losa|azotea|terraza|recrecido|autonivelante|capa de compresion|placa alveolar|zahorra|explanada|desbroce)\b/;
  const RE_V = /\b(papel pintado|empapelado|papel|gotele|estuco|friso|alicatado|paramento vertical|pared|tabique|tabiqueria|fachada|enlucido|guarnecido|enfoscado|vertical|muro|cerramiento|aplacado|trasdosado|hoja de|fabrica de|medianera|revestimiento vertical|celosia|mampara|tapia)\b/;
  /** 'V' (paredes), 'H' (suelo/techo) o null si no se puede saber por el texto. */
  function guessOrient(t) {
    const n = norm(t);
    const v = RE_V.test(n) || /papel|empapelad|gotele|estuco|friso|pintura de paredes|paramento/.test(n);
    const h = RE_H.test(n);
    if (v && !h) return 'V'; if (h && !v) return 'H';
    return null;
  }
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
      case 'ud': return { need: [], ask: isCarpinteria(p) ? '¿Cuántas unidades? Si quieres, añade la medida del hueco, ancho por alto en metros, por ejemplo «2 de 1,20 por 1,40».' : '¿Cuántas unidades?' };
      case 'm': return { need: ['l'], ask: '¿Longitud, en metros? Si son varios tramos iguales, dime cuántos, por ejemplo «3 tramos de 2,40».' };
      case 'm2': return p.orient === 'V' ? { need: ['l', 'h'], ask: '¿Largo y alto, en metros? Por ejemplo «3,40 por 2,50».' } : { need: ['l', 'a'], ask: '¿Largo y ancho, en metros? Por ejemplo «4,20 por 3,10».' };
      case 'm3': return { need: ['l', 'a', 'h'], ask: '¿Largo, ancho y alto o espesor, en metros? Por ejemplo «5 por 0,60 por 0,80».' };
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
        if (p.u === 'ud' && dims.length >= 2) { line.hueco = { a: cm(dims[0]), h: cm(dims[1]) }; dims = dims.slice(2); }
      } else if (dims.length) {
        if (p.u === 'ud' && dims.length >= 2 && isCarpinteria(p)) { line.uds = 1; line.hueco = { a: cm(dims[0]), h: cm(dims[1]) }; dims = dims.slice(2); }
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
  /** Un hueco de más de 10 m es casi seguro un dictado en centímetros ("120 por 210"). */
  function cm(v) { return v > 10 ? round2(v / 100) : v; }
  function parcial(l) {
    if (l.hPend && (l.h === null || l.h === undefined)) return 0;
    let v = l.uds === null || l.uds === undefined ? 1 : l.uds;
    for (const k of ['l', 'a', 'h']) if (l[k] !== null && l[k] !== undefined) v *= l[k];
    return round2(v);
  }
  const totalOf = (p) => round2(p.lineas.reduce((a, l) => a + parcial(l), 0));

  /* ---------------- Planta dibujada a partir de un recorrido de paredes ---------------- */
  /** tramos: [{ l, giro: 'izquierda'|'derecha'|'', ang }] → polígono, superficie, perímetro y cierre. */
  function calcPlanta(tramos) {
    const pts = [[0, 0]];
    let hd = 0, x = 0, y = 0, dir = 1;
    tramos.forEach((t, i) => {
      x += t.l * Math.cos(hd); y += t.l * Math.sin(hd); pts.push([x, y]);
      if (t.giro === 'izquierda') dir = 1; else if (t.giro === 'derecha') dir = -1;
      hd += dir * ((t.ang || 90) * Math.PI / 180);
    });
    const r = { pts, cierre: 'exacto', aviso: '', supuestas: [] };
    const eps = 0.03;
    const [x0, y0] = pts[0];
    const dx = x0 - x, dy = y0 - y, gap = Math.hypot(dx, dy);
    const recto = tramos.every((t) => !t.ang || Math.abs(t.ang - 90) < 0.5);
    if (gap <= eps) pts.pop();
    else if (tramos.length < 2) { r.aviso = 'faltan paredes'; r.abierta = true; }
    else if (!recto || Math.min(Math.abs(dx), Math.abs(dy)) <= eps) { r.cierre = '1'; r.supuestas.push(round2(gap)); }
    else {
      // Con giros de 90°: faltan dos paredes perpendiculares; la primera sigue perpendicular a la última dicha
      const hx = Math.cos(hd - dir * Math.PI / 2), hy = Math.sin(hd - dir * Math.PI / 2); // dirección de la última pared
      const c = Math.abs(hx) > 0.5 ? [x, y0] : [x0, y];
      pts.push(c); r.cierre = '2';
      r.supuestas.push(round2(Math.hypot(c[0] - x, c[1] - y)), round2(Math.hypot(x0 - c[0], y0 - c[1])));
    }
    let a = 0, per = 0;
    for (let i = 0; i < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length]; a += ax * by - bx * ay; per += Math.hypot(bx - ax, by - ay); }
    r.area = round2(Math.abs(a) / 2); r.perimetro = round2(per);
    // Comprobación: un polígono que se cruza consigo mismo es una medida mal tomada
    const segs = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
    const cruza = (p1, p2, p3, p4) => { const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return d(p1, p2, p3) * d(p1, p2, p4) < -1e-6 && d(p3, p4, p1) * d(p3, p4, p2) < -1e-6; };
    for (let i = 0; i < segs.length; i++) for (let j = i + 2; j < segs.length; j++) { if (i === 0 && j === segs.length - 1) continue; if (cruza(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) r.aviso = 'las paredes se cruzan: alguna medida o giro no cuadra'; }
    return r;
  }
  /** Lee un recorrido dictado ("pared uno 6 metros, a la izquierda, pared dos 3...") sin IA.
   *  Devuelve los tramos o null si la frase no sigue ese patrón con claridad. */
  const ANGULOS = new Set([30, 45, 60, 90, 120, 135, 150, 180, 270]);
  function parseRecorrido(text) {
    // "4 m, 90°": la coma separa la medida del ángulo (no es 4,90)
    const n = norm(String(text).replace(/(\d+)\s*[°º]/g, '$1 grados').replace(/,\s+(?=\d+\s*grados)/g, ' y ').replace(/,\s+(?=(?:a\s+)?(?:30|45|60|90|120|135|150|180|270)\b)/g, ' y '));
    const parts = n.split(/\b(?:pared|la ultima|ultima|otra pared|siguiente pared)\b/);
    if (parts.length < 2) return null;
    const out = [];
    for (const ch of parts.slice(1)) {
      const tk = tokenize(ch);
      const nums = [];
      let ang = 90, giro = '';
      const hayGiro = /(izquierda|derecha|giro|gira|grados)/.test(ch);
      tk.forEach((t, i) => {
        if (t.k === 'N') {
          const nx = tk[i + 1];
          // "90 grados", o "a 90 a la derecha": es un ángulo, no una pared
          if ((nx && nx.k === 'W' && /^grados?$/.test(nx.n)) || (hayGiro && ANGULOS.has(t.v) && !t.unit && nums.length >= 1)) ang = t.v; else nums.push(t);
        }
        else if (t.k === 'W' && (t.n === 'izquierda' || t.n === 'derecha')) giro = t.n;
      });
      let l;
      if (nums.length === 1) l = nums[0].v;
      else if (nums.length === 2 && Number.isInteger(nums[0].v) && nums[0].v <= 30 && !nums[0].unit) l = nums[1].v; // "pared cinco, cuatro metros"
      else return null;
      if (!(l > 0 && l < 200)) return null;
      out.push({ l: round2(l), giro, ang });
    }
    return out.length ? out : null;
  }
  /** Croquis SVG de la planta con la longitud de cada pared (se dibuja en el móvil, sin IA). */
  function plantaSVG(pl) {
    const pts = pl.pts; if (!pts || pts.length < 3) return '';
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 260, pad = 34, sc = Math.min((W - 2 * pad) / Math.max(maxX - minX, 0.1), (W - 2 * pad) / Math.max(maxY - minY, 0.1));
    const H = Math.round((maxY - minY) * sc + 2 * pad);
    const P = (p) => [round2(pad + (p[0] - minX) * sc), round2(H - pad - (p[1] - minY) * sc)];
    const sp = pts.map(P);
    const nReal = pl.tramos.length;
    const cx = sp.reduce((t, q) => t + q[0], 0) / sp.length, cy = sp.reduce((t, q) => t + q[1], 0) / sp.length;
    let lab = '';
    sp.forEach((a, i) => {
      const b = sp[(i + 1) % sp.length], o = pts[i], q = pts[(i + 1) % pts.length];
      const len = Math.hypot(q[0] - o[0], q[1] - o[1]);
      const sup = i >= nReal;
      // Cota hacia fuera de la sala
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, sl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let nx = -(b[1] - a[1]) / sl, ny = (b[0] - a[0]) / sl;
      if ((mx + nx - cx) * nx + (my + ny - cy) * ny < 0) { nx = -nx; ny = -ny; }
      lab += '<text x="' + round2(mx + nx * 14) + '" y="' + round2(my + ny * 12 + 4) + '" text-anchor="middle" font-size="11" fill="currentColor"' + (sup ? ' font-style="italic" opacity=".7"' : '') + '>' + fmt(len) + '</text>';
    });
    return '<svg class="planta-svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px" role="img" aria-label="Croquis de la planta">' +
      '<polygon points="' + sp.map((p) => p.join(',')).join(' ') + '" fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
      '<circle cx="' + sp[0][0] + '" cy="' + sp[0][1] + '" r="3.5" fill="currentColor"/>' + lab + '</svg>';
  }

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
    if (/parcial|una estancia|solo una|solo un|una habitacion|una zona|pequena|algunas estancias|un par de/.test(n)) return { id: 'estancia' };
    if (/integral|vivienda|piso|casa|reforma completa|toda la|reforma|chalet|apartamento|edificio/.test(n)) return { id: 'vivienda' };
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
      // Asistente guiado (toma de datos → trabajos → mediciones)
      let G = root.Guia || null;
      if (!G && typeof require !== 'undefined') { try { G = require('./guia.js'); } catch (e) { G = null; } }
      this.guia = G ? new G.Guia(this) : null;
    }
    get cat() { return this.io.getCatalog(); }
    setObra(obra) {
      this.obra = obra; this.undo = []; this.state = { mode: 'idle' };
      if (!obra) return;
      if (this.guia && this.guia.activo) return this.guia.resume();
      if (!obra.ambito) return this.guia ? this.guia.start('Obra creada.') : this.askAmbito(true);
      const act = this.active();
      const est = obra.estActiva ? ' Estancia: ' + obra.estActiva + '.' : '';
      this.ask('Obra ' + obra.titulo + ' abierta.' + est + (act ? ' Partida activa: ' + act.r + '.' : '') + ' Dime el trabajo a medir.', this.idleChips());
    }
    /* ---- helpers de salida ---- */
    ask(text, chips, opts) { if (this.muteAsk) return; this.lastPrompt = { text, chips, opts }; this.io.say(text, chips || [], Object.assign({ listen: true }, opts || {})); }
    tell(text, chips) { this.ask(text, chips, { listen: true }); }
    idleChips() {
      const c = [];
      if (this.active()) c.push({ label: 'Siguiente partida', value: 'siguiente partida' }, { label: 'Cambiar partida', value: 'cambia la partida' }, { label: 'Leer líneas', value: 'lee las líneas' });
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
      // Asistente guiado: mientras está en marcha atiende todas las respuestas
      if (this.guia && (text || (input && input.act))) {
        if (this.guia.activo) return this.guia.handle(text, n, input);
        if (/^(medir otra zona|nueva zona|otra zona|asistente guiado|medicion guiada|empezar asistente|medir algo mas)\b/.test(n)) return this.guia.start();
        const mb = n.match(/^(?:borra|borrar|elimina|eliminar|quita|quitar)\s+(?:la |el )?(?:estancia|zona|fachada|cubierta|habitacion)\s+(.+)$/);
        const G = root.Guia || (typeof require !== 'undefined' ? require('./guia.js') : null);
        if (mb && G && this.obra.toma) { const z = G.buscarZona(this.obra, mb[1]); if (z) return this.guia.pedirBorrar(z); }
        if (G && !(input && input.act) && n.split(' ').length >= 4 && this.state.mode === 'idle') { const inc = G.detectarIncidencia(n); if (inc && /\b(hay|tiene|tienen|habra|hay que|he visto|veo|esta|estan|tambien|ojo|repar)\b/.test(n)) return this.guia.incidencia(inc, text); }
        if (/^(elegir trabajos|elige trabajos|elegir mas trabajos|seleccionar trabajos|pantalla de trabajos|elige los trabajos)\b/.test(n) && this.obra.toma && this.obra.toma.zonas.length) return this.guia.abrirTrabajos();
      }
      // Comandos globales que funcionan en cualquier estado
      if (text) {
        if (/^(cancela|cancelar|olvidalo|dejalo)\b/.test(n) && !/^(cancela|cancelar|olvidalo|dejalo)$/.test(n) && !this.noAgent && this.agentReady() && this.state.mode !== 'thinking') { this.changing = null; this.state = { mode: 'idle' }; return this.runAgent(text); }
        if (/^(cancela|cancelar|olvidalo|dejalo)\b/.test(n)) { this.changing = null; this.state = { mode: 'idle' }; return this.ask('Cancelado. ¿Qué medimos?', this.idleChips()); }
        if (/^(repite|repitelo|como|que has dicho|perdona)\b/.test(n) && this.lastPrompt) return this.ask(this.lastPrompt.text, this.lastPrompt.chips);
        if (/^(ayuda|que puedo decir|comandos)\b/.test(n)) return this.help();
        if (/^(deshaz|deshacer|deshace|anula lo ultimo|anula|atras|vuelve atras|para atras|deshaz eso)\b/.test(n)) return this.doUndo();
        if (/^(para|parar|paro|stop|basta|basta ya|calla|callate|silencio|espera|pausa|para de escuchar|deja de escuchar|para ya)$/.test(n)) return this.stopAll();
      }
      const st = this.state;
      const h = this['st_' + st.mode];
      if (h) return h.call(this, text, n, input);
      return this.st_idle(text, n, input);
    }
    /** Parar: corta la pregunta en curso y pone el micro en pausa. */
    stopAll() {
      this.changing = null; this.state = { mode: 'idle' };
      this.io.pause && this.io.pause();
      this.lastPrompt = { text: 'Dime el trabajo a medir.', chips: this.idleChips() };
      this.io.say('En pausa. Toca el micro cuando quieras seguir.', this.idleChips(), { listen: false });
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
      if (!r) {
        // No bloquear: si no se entiende el ámbito, se sigue como vivienda (permite cualquier estancia y partida)
        if (this.escape(text, n)) return;
        this.obra.ambito = 'vivienda'; this.touch();
        return this.askEstancia(false, 'Lo trato como reforma de vivienda. ');
      }
      this.obra.ambito = r.id;
      if (r.est) { this.setEstancia(r.est, true); this.touch(); this.state = { mode: 'idle' }; return this.ask('Perfecto, medimos ' + art(r.est) + '. ¿Cuál es el primer trabajo? Por ejemplo: picado de azulejos.'); }
      this.touch();
      if (r.id === 'libre') { this.state = { mode: 'idle' }; return this.ask('Medición libre. Dime el primer trabajo a medir.'); }
      return this.askEstancia(r.id === 'instalaciones');
    }
    askEstancia(optional, prefix) {
      this.state = { mode: 'estancia' };
      const used = this.obra.estancias || [];
      const sugg = (this.obra.ambito === 'estancia' ? ['Baño', 'Cocina', 'Aseo', 'Local'] : DEFAULT_ESTANCIAS).filter((e) => !used.includes(e));
      const chips = sugg.slice(0, 7).map((e) => ({ label: e, value: e }));
      if (optional) chips.push({ label: 'Sin estancia', value: 'sin estancia' });
      this.ask((prefix || '') + (used.length ? '¿A qué estancia pasamos?' : '¿Por qué estancia empezamos?'), chips);
    }
    st_estancia(text, n) {
      if (/sin estancia|ninguna|general/.test(n)) { this.obra.estActiva = ''; this.touch(); this.state = { mode: 'idle' }; return this.ask('Sin estancia. Dime el trabajo a medir.'); }
      const limpio = norm(text).replace(/^(?:bueno|vale|ok|pues|ahora|venga|y)\s+/, '')
        .replace(/^(?:vamos a |voy a |ahora )?(?:empezar|empezamos|empiezo|seguir|seguimos|sigo|continuar|continuamos|pasar|pasamos|paso|ir|vamos|estamos|estoy|entramos|entro|medir|medimos)\s*(?:con|por|a|al|en|hacia)?\s*(?:el|la|los|las)?\s+/, '');
      // Frase larga o con verbos: que la entienda la IA
      if (limpio.split(/\s+/).length > 3 && !this.noAgent && this.agentReady()) return this.runAgent(text, '¿En qué estancia estamos?');
      const name = estanciaName(limpio);
      if (!name || !/[a-zñ]/i.test(norm(name))) return this.ask('¿Qué estancia? Dime su nombre, por ejemplo: baño, dormitorio 2.', this.lastPrompt.chips);
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
      this.changing = null; // si se abandona una corrección de partida a medias, se descarta
      if (input && input.act) return this.handleAct(input.act);
      if (!text) return;
      // Recorrido de paredes dictado con su patrón ("pared uno 4 metros, a la derecha..."): lo resuelve la app al instante
      if (/(pared|ultima)/.test(n) && /(izquierda|derecha|giro|gira|grados|cierr)/.test(n + text)) {
        const det = parseRecorrido(text);
        if (det) {
          this.lastAgentText = text;
          const r = { acciones: [{ tipo: 'recorrido', tramos: det.map((d) => ({ largo: d.l, giro: d.giro, angulo: d.ang })), continuar: true, cerrar: /(cierr|ya esta|termin|principio)/.test(n) }], mensaje: '', pregunta: null, opciones: [] };
          return this.applyAgent(r);
        }
      }
      // IA primero: todo lo que no sea una medida suelta o una orden exacta lo interpreta la IA con el contexto completo
      if (!this.noAgent && this.agentReady() && !this.isTrivial(text, n)) return this.runAgent(text);
      const act = this.active();

      if (this.tryCommands(text, n) !== false) return;

      // Varios rectángulos en una frase: "4 por 3 y 2 por 1,5" / "4 por 3 más 2 por 1,5"
      if (act && (n.match(/\bpor\b/g) || []).length >= 2 && !DEDUC_ANY.test(n)) {
        const parts = text.split(/\s+(?:y|mas|más|\+|otro de|otra de|otro|otra)\s+(?=(?:[\w,áéíóú]+\s+){0,4}?(?:\d|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b[^]*?\bpor\b)/i).filter((x) => parseMeasure(x).count >= 2);
        if (parts.length >= 2) {
          this.geo = this.geo && this.geo.uid === act.uid ? this.geo : { uid: act.uid, est: this.obra.estActiva || '', n: 0 };
          const n0 = act.lineas.length;
          this.muteAsk = true;
          try { parts.forEach((x) => { this.state = { mode: 'idle' }; this.st_idle(x, norm(x)); }); } finally { this.muteAsk = false; }
          const added = act.lineas.slice(n0);
          return this.ask('Anotadas ' + added.length + ' partes: ' + added.map((l) => fmt(parcial(l))).join(' más ') + '. Total ' + fmt(totalOf(act)) + ' ' + unitSpoken(act.u) + '. ¿Otra medida?', this.idleChips());
        }
      }
      // Medida + hueco en la misma frase: "3,40 por 2,60 y quita la ventana de 1,20 por 1,10" → dos líneas
      if (act) {
        const mm = text.match(/^(.+?)\s*,?\s+(?:y\s+)?((?:descuenta|descontando|descontar|quita|quitando|resta|restando|menos|deduce|deduciendo)\b.+)$/i);
        if (mm && parseMeasure(mm[1]).count >= 1 && parseMeasure(mm[2]).count >= 1) {
          this.st_idle(mm[1].replace(/\s+y\s*$/i, ''), norm(mm[1]));
          return this.st_idle(mm[2], norm(mm[2]));
        }
      }
      // Medición
      const pm = parseMeasure(text);
      if (pm.count > 0 || pm.n !== null) {
        if (act && this.looksLikeMeasure(pm, text, act)) return this.addMeasure(pm, text);
        if (!act && pm.ded) return this.ask('Primero dime a qué partida descuento el hueco.');
        if (!act && pm.count >= 2) return this.ask('No hay ninguna partida activa. Dime primero el trabajo, por ejemplo "alicatado de paredes".');
      }
      if (act && /^(si|vale|ok|sigue|seguimos|otra|otra medida|mas)$/.test(n)) return this.ask(this.dimsAsk(act));
      // Refinar la última búsqueda: "mecánicos", "exterior"…
      if (this.lastQuery && /^(con |de |en |por )?(medios )?(manual(es)?|mecanic[oa]s?|a mano|a maquina|interior|exterior|con recuperacion|sin recuperacion|con carga|sin carga)$/.test(n)) {
        const res = this.cat.index.search(this.lastQuery, this.boostFn());
        const cands = res.filter((r) => r.s >= (res[0] ? res[0].s * 0.8 : 0)).slice(0, 60);
        const f = prefilter(cands, text);
        if (f.length === cands.length || !f.length || (act && f.some((r) => r.doc.c === act.ref))) return this.ask('En la base no hay otra variante' + (act ? '; sigo con ' + act.r + '. ' + this.dimsAsk(act) : '.'), this.idleChips());
        return this.funnelStart(this.lastQuery + ' ' + text, f, []);
      }
      // Con una partida en marcha, una frase corta y ambigua puede ser una aclaración, no un trabajo nuevo: que decida la IA
      if (act && this.io.aiReady && this.io.aiReady() && contentWords(text).length <= 3) {
        const r0 = this.cat.index.search(text, this.boostFn());
        const strong = r0.length && r0[0].miss === 0 && r0[0].nKey >= 2 && r0[0].s >= 0.6;
        if (!strong) return this.aiOr(text, 'hay una partida en marcha («' + act.r + '», en ' + unitSpoken(act.u) + '); decide si es una medida, una aclaración sobre la forma de medir, una orden o un trabajo nuevo', () => this.selectWork(text));
      }
      return this.selectWork(text);
    }
    /* ---- Geometría: salas en L o irregulares ---- */
    geoHelp() {
      const act = this.active();
      if (!act) return this.ask('Primero dime el trabajo a medir; luego te ayudo con la forma de la sala.', this.idleChips());
      this.geo = { uid: act.uid, est: this.obra.estActiva || '', n: 0 };
      if (act.u === 'm2' && act.orient === 'V') return this.ask('Sin problema: en paredes da igual la forma de la sala. Dime la longitud de cada tramo de pared en metros, uno a uno, y al final la altura.', this.idleChips());
      return this.ask('Sin problema. Divide la sala en rectángulos y dímelos uno a uno, en metros, por ejemplo «4 por 3» y luego «2 por 1,5». También puedes decir los dos a la vez («4 por 3 y 2 por 1,5»), darme la superficie total («superficie 18,5») o medir el rectángulo grande y descontar el trozo que falta («descuenta 1,5 por 2»).',
        [{ label: 'Ya está', value: 'siguiente partida' }, { label: 'Leer líneas', value: 'lee las líneas' }]);
    }
    /** Comandos reconocibles en cualquier momento. Devuelve false si no es un comando. */
    tryCommands(text, n) {
      const act = this.active();
      let m;
      // Estancias
      if (/^(siguiente|otra|cambio de|cambiar de|cambia de|cambiar|nueva) estancia\b/.test(n)) return this.guardHeights(text, () => this.nextEstancia());
      m = n.match(/^(?:pasamos|vamos|pasa|cambiamos|cambia|nos vamos|seguimos|ahora|estamos|entramos)\s+(?:a|al|a la|en|en el|en la|por|por el|por la|con el|con la)\s+(.+)$/) || n.match(/^estancia\s+(.+)$/);
      if (m && (EST_VOCAB.test(m[1].replace(/^(el|la)\s+/, '')) || n.startsWith('estancia') || (this.obra.estancias || []).some((e) => norm(e) === m[1].replace(/^(el|la)\s+/, '')))) {
        return this.guardHeights(text, () => this.st_estancia(m[1], norm(m[1])));
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
      if (/\b(comparte|compartir|compartelo|compartelos|comparteme)\b/.test(n) && this.io.shareFiles) { this.io.shareFiles(); return this.ask('Elige qué archivos quieres y pulsa Compartir.', this.idleChips(), { listen: false }); }
      if (/\b(envia|enviame|enviar|manda|mandame|mandar)\b.*\b(correo|email|mail|e-mail)\b|\b(por|al|a mi) correo\b/.test(n) && this.io.sendEmail) { this.io.sendEmail(); return this.ask('Elige qué archivos quieres recibir y pulsa Enviar.', this.idleChips(), { listen: false }); }
      if (/^(exporta|exportar|genera|generar|saca|sacar|crea|crear|descarga|descargar|pasa|pasar)\b.*\b(excel|xls|xlsx|hoja de calculo|hoja)\b/.test(n)) { this.io.exportXlsx && this.io.exportXlsx(); return this.ask('Generando el Excel de mediciones.'); }
      if (/^(exporta|exportar|genera|generar|saca|sacar|crea|crear|descarga|descargar|pasa|pasar)\b.*\b(bc3|be ce tres|bece3|presto|arquimedes|fiebdc)\b/.test(n)) { this.io.exportBc3 && this.io.exportBc3(); return this.ask('Generando el BC3 de mediciones.'); }
      if (/^(exporta|exportar|genera|generar|saca|sacar|crea|crear|descarga|descargar)\s+(el\s+|un\s+)?(pdf|informe|listado)/.test(n)) { this.io.exportPdf(); return this.ask('Generando el PDF de mediciones.'); }

      // Herencia geométrica por comando
      if ((m = n.match(/^(?:aplica|usa|pon|copia|coge|toma)\s+(?:las\s+)?(?:mismas\s+)?(?:medidas|superficies|mediciones|lineas)\s+(?:que|de|del)\s+(?:en\s+)?(?:el|la|los|las)?\s*(.+)$/))) return this.cmdCopyFrom(m[1]);
      if ((m = n.match(/^copia\s+(?:las\s+|los\s+)?(paredes|paramentos|suelos?|techos?|medidas)\s+(?:del|de la|de|de los)\s+(.+?)(?:\s+(?:pero\s+)?(?:descuenta|descontando|quitando|restando|y descuenta|menos)\s+(?:las\s+|los\s+)?(ventanas|puertas|huecos|carpinterias?))?$/))) return this.cmdCopyRoom(m[1], m[2], m[3]);

      // Perímetro: "perímetro 14,20", "el perímetro es 3,40 más 2,80 más 3,40 más 2,80"
      if (act && (m = n.match(/^(?:el\s+)?perimetro\s*(?:total|es|son|de|mide|:)?\s*(?:de\s+)?(.+)$/))) {
        const pm = parseMeasure(m[1]);
        const vals = pm.dims.concat(Object.values(pm.labeled));
        if (vals.length) {
          const per = round2(vals.reduce((a, b) => a + b, 0));
          if (this.isWall(act) || act.u === 'm') {
            const h = this.isWall(act) ? this.alturaEst(this.obra.estActiva) : null;
            this.snapshot();
            const nl = { id: this.nextId(act), est: this.estPrefix(), com: 'Perímetro', uds: 1, l: per, a: null, h: this.isWall(act) ? h : null };
            if (this.isWall(act) && !h) nl.hPend = true;
            act.lineas.push(nl); act.mod = Date.now(); this.touch(); this.io.flash && this.io.flash('ok');
            const sumTxt = vals.length > 1 ? ' (' + vals.map((v) => fmt(v)).join(' + ') + ')' : '';
            if (this.isWall(act) && !h) { this.state = { mode: 'altura', after: '' }; return this.ask('Perímetro de ' + fmt(per) + ' metros' + sumTxt + '. ¿Qué altura tienen las paredes, en metros?', [{ label: 'Dejarlo sin altura', value: 'sin altura', act: { skipH: true } }]); }
            return this.ask('Perímetro de ' + fmt(per) + ' metros' + sumTxt + (h ? ' por ' + fmt(h) + ' de altura' : '') + '. Total ' + fmt(totalOf(act)) + ' ' + unitSpoken(act.u) + '. ' + (this.isWall(act) ? '¿Hay puertas o ventanas que descontar?' : '¿Algo más?'), this.idleChips());
          }
        }
      }
      // Forma de la sala
      if (/\b(no es rectangular|no es cuadrad[ao]|no es regular|es irregular|forma (de|en) (l|ele|u|t)|en forma de|tiene forma|en (l|ele)$|es una (l|ele)|dos rectangulos|varios rectangulos|tiene un entrante|tiene un saliente|tiene una esquina|esta dividid[ao]|en dos partes|en varias partes|como mido|como lo mido)\b/.test(n)) return this.geoHelp();
      // Superficie total dictada directamente
      if (act && ['m2', 'm3'].includes(act.u) && (m = n.match(/^(?:la\s+)?(?:superficie|area|total|superficie total)\s*(?:total|es|son|de|mide|:)?\s*(?:de\s+)?(.+?)(?:\s*metros cuadrados|\s*m2)?$/) || n.match(/^(?:son|mide|tiene)\s+(.+?)\s*(?:metros cuadrados|m2)$/))) {
        const v = parseNumber(m[1]);
        if (v !== null && v > 0 && contentWords(m[1].replace(/metros?|cuadrados?/g, '')).length <= 1) {
          this.snapshot();
          const nl = { id: this.nextId(act), est: this.estPrefix(), com: 'Superficie total', uds: 1, l: v, a: null, h: null };
          act.lineas.push(nl); act.mod = Date.now(); this.touch(); this.io.flash && this.io.flash('ok');
          return this.ask('Anotada la superficie de ' + fmt(v) + ' metros cuadrados. Total ' + fmt(totalOf(act)) + '. ¿Algo más?', this.idleChips());
        }
      }
      // Altura común de la estancia ("la altura es 2,60")
      if (!this.state.pending && (m = n.match(/^(?:y\s+)?(?:la\s+)?(?:altura|alto)(?:\s+(?:libre|de (?:la )?(?:estancia|habitacion|pared|paredes|las paredes|suelo a techo|techo)))?\s*(?:es|son|de|a|:|=)?\s*(.+)$/) || n.match(/^(?:la\s+)?(?:estancia|habitacion)\s+tiene\s+(.+?)\s+de\s+altura$/))) {
        const v = parseNumber(m[1]);
        if (v !== null && v > 0.3 && v < 20 && contentWords(m[1]).length <= 1) return this.setAltura(v);
      }
      // Terminar la medición
      if (/^(terminar|termina|terminamos|terminado|he terminado|hemos terminado|ya he terminado|ya hemos terminado|fin|finalizar|finaliza|finalizamos|acabar|acaba|acabamos|acabado|he acabado|hemos acabado|eso es todo|ya esta todo|se acabo|fin de la (medicion|visita)|terminar (la )?(medicion|visita)|termina (la )?(medicion|visita)|finalizar (la )?(medicion|visita)|terminamos (la )?(medicion|visita)|salir|cerrar (la )?(medicion|visita))$/.test(n)) return this.guardHeights(text, () => this.endSession());
      if (/^(no|nada|nada mas|no nada mas|no hay mas|no hay nada mas|ya no|no gracias|no mas)$/.test(n)) {
        if (act) { this.obra.activa = null; this.touch(); }
        return this.ask('De acuerdo. ¿Pasamos a otra estancia o terminamos la medición?', [{ label: 'Otra estancia', value: 'siguiente estancia' }, { label: 'Terminar medición', value: 'terminar' }]);
      }
      // Fin de partida
      if (/^(siguiente partida|nueva partida|otra partida|fin de (la )?partida|cerramos (la )?partida|cierra (la )?partida|ya esta|listo|vale ya|cambio de partida|cambiamos de partida|siguiente trabajo|otro trabajo)$/.test(n)) {
        if (this.guardHeightsNeeded()) return this.guardHeights(text);
        this.obra.activa = null; this.touch();
        const e = this.obra.estActiva;
        if (e && this.obra.ambito !== 'libre') return this.ask('Partida cerrada. ¿Qué más hay que hacer en ' + art(e) + '? Si aquí no hay nada más, di "siguiente estancia" o "terminar".', [{ label: 'Siguiente estancia', value: 'siguiente estancia' }, { label: 'Terminar medición', value: 'terminar' }]);
        return this.ask('Partida cerrada. Dime el siguiente trabajo.', this.idleChips());
      }
      if (act && /^(las )?(mismas|mismas medidas|las mismas medidas|mismas mediciones|copia las medidas|copia las mismas|igual que la anterior|las de antes|lo mismo)$/.test(n)) {
        const srcs = this.sameEstSources(act);
        if (!srcs.length) return this.ask('No tengo otra partida medida en ' + art(this.obra.estActiva || 'esta estancia') + ' con medidas compatibles. ' + this.dimsAsk(act), this.idleChips());
        return this.doSame(act, srcs[0], '');
      }
      if (/^(seguir midiendo|seguimos midiendo|continuar|continuamos|seguimos)$/.test(n)) { const a = this.active(); return this.ask(a ? 'Seguimos con ' + a.r + '. ' + this.dimsAsk(a) : 'Seguimos' + (this.obra.estActiva ? ' en ' + art(this.obra.estActiva) : '') + '. Dime el trabajo a medir.', this.idleChips()); }
      if (/^(crear( una)?( nueva)?( partida)?( nueva)?|crea( una)?( nueva)?( partida)?|crear nueva|partida nueva|creamos una( partida)? nueva)$/.test(n)) return this.createStart(this.pendingQuery || this.lastQuery || '', [], true);
      if ((m = n.match(/^(?:no[, ]+)?(?:es|son|se mide|mide|medimos|va)?\s*(?:en|de|por)?\s*(?:las|los|el|la)?\s*(paredes|pared|paramentos|vertical|suelo|suelos|techo|techos|horizontal)$/)) && act && act.u === 'm2' && !/^(paredes|pared|suelo|techo)$/.test(n)) return this.setOrient(/pared|paramento|vertical/.test(m[1]) ? 'V' : 'H');
      // Corregir la partida elegida ("no es esa", "cambia la partida por…")
      if ((m = n.match(/^(?:no[, ]+)?(?:cambia|cambiar|cambiamos|corrige|corregir|cambio de)\s+(?:la\s+|de\s+|esta\s+)?partida(?:\s+(?:por|a|a la de|que es|es)\s+(.+))?$/))
        || (m = n.match(/^(?:no[, ]+)?(?:no es esa|esa no es|esa no|no es esta|no es la correcta|no era esa|esa no era|partida equivocada|te has equivocado|te equivocaste|me he equivocado|me equivoque|equivocada|otra partida distinta|no es eso|eso no es|esa no me vale)(?:\s+de partida)?(?:[, ]+(?:es|era|quiero|queria|pon|ponme|mejor)?\s*(.+))?$/))
        || (m = n.match(/^no[, ]+(?:es|era|queria|quiero)\s+(.+)$/))) return this.changePartida(m[1] || '');
      // Nueva partida en la misma estancia ("ahora guarnecido", "siguiente partida pintura", "añade…")
      if ((m = n.match(/^(?:y\s+)?(?:siguiente partida|nueva partida|otra partida|partida|ahora|despues|luego|añade|anade|añadir|anadir|añade partida|anade partida|metemos|mete|pon|ponemos|vamos con|seguimos con|busca|buscar|tambien)\s*:?\s+(?:la\s+partida\s+(?:de\s+)?|una\s+partida\s+de\s+|partida\s+de\s+|partida\s+|la\s+|el\s+)?(.+)$/)) && contentWords(m[1]).length >= 1 && !EST_VOCAB.test(m[1])) {
        if (this.guardHeightsNeeded()) return this.guardHeights(text);
        return this.selectWork(m[1]);
      }

      return false;
    }
    /** Desde un estado intermedio: ¿el usuario ha cambiado de tema? */
    escape(text, n) {
      if (!text) return false;
      const prev = this.state;
      this.state = { mode: 'idle' };
      const ch = this.changing; this.changing = null;
      if (this.tryCommands(text, n) !== false) return true;
      this.changing = ch;
      this.state = prev;
      return false;
    }
    /* ---- Paredes: longitudes primero, altura común de la estancia ---- */
    isWall(p) { return p && p.u === 'm2' && p.orient === 'V'; }
    alturaEst(est) { const a = this.obra.alturas || {}; return a[norm(est || '')] || null; }
    dimsAsk(p) {
      if (this.isWall(p)) {
        const h = this.alturaEst(this.obra.estActiva);
        return h ? 'Dime el perímetro de las paredes en metros, por ejemplo «perímetro 14,20»; uso la altura de ' + fmt(h) + ' metros de esta estancia.' : 'Dime el perímetro de las paredes en metros, por ejemplo «perímetro 14,20». También puedes darme cada pared una a una. Después te pido la altura.';
      }
      return dimsSpec(p).ask;
    }
    pendingWalls(est) {
      const out = [];
      this.obra.partidas.forEach((p) => p.lineas.forEach((l) => { if (l.hPend && (l.h === null || l.h === undefined) && norm(l.est || '') === norm(est || '')) out.push([p, l]); }));
      return out;
    }
    guardHeightsNeeded() { return !this.skipHeights && this.pendingWalls(this.obra.estActiva).length > 0; }
    /** Antes de salir de la estancia/partida, pide la altura que falta. */
    guardHeights(text, then) {
      if (!this.guardHeightsNeeded()) return then ? then() : undefined;
      const pw = this.pendingWalls(this.obra.estActiva);
      this.state = { mode: 'altura', after: text };
      return this.ask('Antes: faltan ' + (pw.length === 1 ? '1 pared' : pw.length + ' paredes') + ' sin altura en ' + art(this.obra.estActiva) + '. ¿Qué altura tienen, en metros?', [{ label: 'Dejarlo sin altura', value: 'sin altura', act: { skipH: true } }]);
    }
    st_altura(text, n, input) {
      const st = this.state;
      const skip = (input && input.act && input.act.skipH) || /^(sin altura|luego|despues|mas tarde|no|ahora no|dejalo)/.test(n);
      if (!skip) {
        const v = parseNumber(text);
        if ((v === null || v <= 0.3 || v >= 20 || contentWords(text).filter((w) => !/altura|alto|metros?/.test(w)).length) && this.agentReady()) { this.state = { mode: 'idle' }; return this.runAgent(text, 'la app había preguntado la altura de las paredes de la estancia'); }
        if (v === null || v <= 0.3 || v >= 20) return this.ask('Dime la altura, por ejemplo: 2,60.', this.lastPrompt.chips);
        this.state = { mode: 'idle' };
        this.applyAltura(v);
      } else this.state = { mode: 'idle' };
      if (!st.after) { if (skip) return this.ask('Vale, sin altura de momento.', this.idleChips()); const pw2 = this.obra.partidas.filter((p) => p.lineas.some((l) => norm(l.est || '') === norm(this.obra.estActiva || ''))); const a = this.active(); return this.ask('Altura ' + fmt(this.alturaEst(this.obra.estActiva)) + ' aplicada.' + (a ? ' Total ' + fmt(totalOf(a)) + ' ' + unitSpoken(a.u) + '.' : '') + ' ¿Hay puertas o ventanas que descontar?', this.idleChips()); }
      this.skipHeights = true;
      try { this.state = { mode: 'idle' }; const t = st.after; if (this.tryCommands(t, norm(t)) === false) this.st_idle(t, norm(t)); } finally { this.skipHeights = false; }
    }
    applyAltura(v) {
      const est = this.obra.estActiva;
      this.obra.alturas = this.obra.alturas || {};
      this.obra.alturas[norm(est || '')] = v;
      const pw = this.pendingWalls(est);
      if (pw.length) this.snapshot();
      pw.forEach(([p, l]) => { l.h = v; delete l.hPend; });
      this.touch();
      return pw;
    }
    setAltura(v) {
      const pw = this.applyAltura(v);
      const act = this.active();
      const est = this.obra.estActiva;
      if (!pw.length) return this.ask('Altura de ' + art(est || 'la obra') + ': ' + fmt(v) + '. La usaré para las paredes que me dictes aquí.' + (act ? ' ' + this.dimsAsk(act) : ''), this.idleChips());
      const ps = [...new Set(pw.map(([p]) => p))];
      this.io.flash && this.io.flash('ok');
      this.ask('Altura ' + fmt(v) + ' aplicada a ' + (pw.length === 1 ? '1 pared' : pw.length + ' paredes') + '. ' + ps.map((p) => 'Total ' + p.r + ': ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u)).join('. ') + '. ¿Hay puertas o ventanas que descontar? Por ejemplo: descuenta puerta de 0,82 por 2,03.', this.idleChips());
    }
    endSession() {
      this.obra.activa = null; this.state = { mode: 'idle' }; this.touch();
      const ps = this.obra.partidas.filter((p) => p.lineas.length);
      const nl = ps.reduce((a, p) => a + p.lineas.length, 0);
      const pend = this.obra.partidas.reduce((a, p) => a + p.lineas.filter((l) => l.hPend && l.h == null).length, 0);
      this.ask('Medición terminada. Llevas ' + ps.length + (ps.length === 1 ? ' partida' : ' partidas') + ' y ' + nl + (nl === 1 ? ' línea' : ' líneas') + ((this.obra.estancias || []).length ? ' en ' + (this.obra.estancias || []).length + ((this.obra.estancias || []).length === 1 ? ' estancia.' : ' estancias.') : '.') + (pend ? ' Quedan ' + pend + ' paredes sin altura.' : '') + ' Puedes generar el PDF, el Excel o el BC3, o seguir midiendo cuando quieras.',
        [{ label: 'Compartir archivos', value: 'compartir los archivos' }, { label: 'Enviar a mi correo', value: 'envíame los archivos por correo' }, { label: 'Generar PDF', value: 'genera el pdf' }, { label: 'Excel', value: 'exporta el excel' }, { label: 'BC3', value: 'exporta el bc3' }, { label: 'Seguir midiendo', value: 'seguir midiendo' }], { listen: false, end: true });
    }
    looksLikeMeasure(pm, text, act) {
      if (pm.ded) return true;
      const content = contentWords(text);
      if (pm.count >= 2) return true;
      if (act.u === 'ud' || act.u === 'm' || !['m2', 'm3'].includes(act.u)) return content.length <= 4;
      return content.length <= 3;
    }
    handleAct(a) {
      if (a.createQ) return this.createStart(a.createQ, [], true);
      if (a.askH) { this.state = { mode: 'altura', after: '' }; return this.ask('¿Qué altura tienen las paredes de ' + art(this.obra.estActiva || 'la estancia') + '?'); }
      if (a.estancia !== undefined) return this.st_estancia(a.estancia, norm(a.estancia));
    }

    /* ---- Selección de partida ---- */
    boostFn() {
      const kw = AMBITOS[this.obra.ambito] && AMBITOS[this.obra.ambito].kw;
      if (!kw) return null;
      return (d) => kw.test(norm(d.path || d.chapTitle || '')) ? 1.12 : 1;
    }
    selectWork(query) {
      this.pendingQuery = query;
      const sm = norm(query).match(/^(.*?)\s*,?\s*(?:con\s+)?(?:las\s+)?(?:mismas medidas|mismas mediciones|mismas superficies|lo mismo|igual que antes|con las mismas)(?:\s+que\s+.*)?$/);
      if (sm && sm[1]) { query = sm[1]; this.autoSame = true; }
      const cw = contentWords(query).filter((w) => !(w in ORD) && !/^(si|no|vale|ok|igual|mismas?|eso|esa|bien|bueno|perfecto|venga|gracias)$/.test(w));
      if (!cw.length) { const a = this.active(); return this.ask('No te he entendido. ' + (a ? this.dimsAsk(a) : 'Dime el trabajo a medir.'), this.idleChips()); }
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
      res = res.filter((r) => !exclude.includes(r.doc.c));
      // Demolición/retirada frente a obra nueva: "quitar moqueta" no es "colocar moqueta"
      const qDem = DEM_Q.test(norm(query));
      const isDemDoc = (r) => DEM_DOC.test(norm(r.doc.r)) || /DEMOLIC/i.test(r.doc.chapTitle || '');
      if (qDem) {
        const f = res.filter(isDemDoc);
        if (!f.length || f[0].s < 0.3) return this.aiOr(query, 'no hay partidas de demolición que encajen', () => this.lowConfidence(query, []));
        res = f;
      } else {
        const f = res.filter((r) => !isDemDoc(r));
        if (f.length && f[0].s >= (res[0] ? res[0].s * 0.6 : 0)) res = f;
      }
      // Cobertura: ¿hay partidas cuyo resumen contenga todo lo importante que se ha dicho?
      const top = res.slice(0, 120);
      const minMiss = top.length ? Math.min(...top.map((r) => r.miss || 0)) : 0;
      if (top.length && minMiss > 0 && top[0].nKey >= 2 && !this.forceCands) return this.aiOr(query, 'ninguna partida contiene todo lo dicho', () => this.lowConfidence(query, top.filter((r) => r.miss === minMiss).slice(0, 4)));
      this.forceCands = false;
      if (top.length && top[0].nKey) res = res.filter((r) => (r.miss || 0) === minMiss);
      const best = res.length ? res[0].s : 0;
      if (best < 0.34) return this.aiOr(query, 'el motor no encuentra la partida', () => this.createStart(query, res));
      let cands = res.filter((r) => r.s >= best * 0.8 && !exclude.includes(r.doc.c)).slice(0, 60);
      if (!cands.length) return this.createStart(query, res);
      cands = prefilter(cands, query);
      this.state = { mode: 'funnel', query, cands, asked: new Set(), all: res.filter((r) => r.s >= best * 0.55 && !exclude.includes(r.doc.c)).slice(0, 40) };
      return this.funnelStep();
    }
    /** No hay partida que encaje del todo: ofrece las más parecidas o crear una nueva. */
    lowConfidence(query, near) {
      if (!near.length) {
        this.state = { mode: 'none', query };
        return this.ask('No encuentro «' + query + '» en la base de datos. ¿Creamos una partida nueva, o me la dices con otras palabras?', [{ label: 'Crear partida nueva', value: 'crear nueva', act: { create: true } }, { label: 'Cancelar', value: 'cancela' }]);
      }
      this.state = { mode: 'list', query, listed: near, low: true };
      const sh = shortLabels(near.map((x) => x.doc.r));
      near.forEach((x, i) => { x.short = sh[i]; });
      const chips = [{ label: 'Crear partida nueva', value: 'crear nueva', act: { create: true } }].concat(near.map((x, i) => ({ label: (i + 1) + '. ' + x.doc.r + ' (' + unitLabel(x.doc.u) + ')', value: x.doc.r, act: { pick: i } })));
      this.ask('No encuentro «' + query + '» en la base de datos. Lo más parecido es: ' + near.slice(0, 3).map((x, i) => (i + 1) + ', ' + x.doc.r).join('; ') + '. ¿Es alguna de estas, o creamos una partida nueva?', chips, { long: true });
    }
    funnelStep(prefix) {
      const st = this.state;
      // Contexto: si en esta estancia estamos con paredes (o techo/suelo), filtra por orientación
      if (!st.ctxDone) {
        st.ctxDone = true;
        const vals = new Set(st.cands.map((c) => c.doc.attrs.orient).filter(Boolean));
        if (vals.size > 1) {
          const q = norm(st.query);
          let want = st.want || (/techo|cielo|horizontal|suelo/.test(q) ? 'horizontal' : /pared|vertical|paramento/.test(q) ? 'vertical' : null);
          if (!want) { const prev = this.lastPartidaHere(); if (prev && prev.u === 'm2') want = prev.orient === 'V' ? 'vertical' : 'horizontal'; }
          if (want) { const f = st.cands.filter((c) => c.doc.attrs.orient !== (want === 'vertical' ? 'horizontal' : 'vertical')); if (f.length) st.cands = f.sort((a, b) => (b.doc.attrs.orient === want) - (a.doc.attrs.orient === want) || b.s - a.s); st.asked.add('orient'); }
        }
      }
      const c = st.cands;
      prefix = prefix ? prefix + ' ' : '';
      if (c.length === 1) return this.propose(c[0].doc, prefix, st.query, st.all || []);
      // Si lo dicho casi coincide con el resumen de una partida, la tomamos sin preguntar
      const qs = new Set(contentWords(st.query).map(stem));
      if (qs.size >= 2) {
        const cov = c.map((x) => { const rw = contentWords(x.doc.r).map(stem); const hit = rw.filter((w) => qs.has(w)).length; return { x, cov: rw.length ? hit / rw.length : 0, all: [...qs].every((q) => rw.includes(q)) }; }).filter((o) => o.all).sort((a, b) => b.cov - a.cov);
        if (cov.length && cov[0].cov >= 0.75 && (!cov[1] || cov[0].cov - cov[1].cov >= 0.1)) return this.propose(cov[0].x.doc, prefix, st.query, c);
      }
      if (c.length <= 4 && !st.asked.has('orient') && new Set(c.map((x) => x.doc.attrs.orient).filter(Boolean)).size > 1) {
        st.split = { a: ATTRS.find((x) => x.id === 'orient'), opts: ['vertical', 'horizontal'] }; st.asked.add('orient');
        st.splitOpts = ['vertical', 'horizontal'];
        if (c.some((x) => !x.doc.attrs.orient)) st.splitOpts.push('Otra / sin especificar');
        return this.ask(prefix + '¿Es en paredes o en techo?', st.splitOpts.map((o, i) => ({ label: optLabel(o), value: o, act: { opt: i } })));
      }
      if (c.length <= 4) { const sh = shortLabels(c.map((x) => x.doc.r)); return this.askList(c, prefix + 'Tengo ' + c.length + ' opciones: ' + sh.map((x, i) => (i + 1) + ', ' + x).join('; ') + '. ¿Cuál?'); }
      const sp = bestSplit(c, st.asked);
      if (!sp) { const sh = shortLabels(c.slice(0, 4).map((x) => x.doc.r)); return this.askList(c.slice(0, 6), prefix + 'Hay ' + c.length + ' opciones parecidas. Te leo las más probables: ' + sh.map((x, i) => (i + 1) + ', ' + x).join('; ') + '. ¿Cuál?'); }
      st.split = sp; st.asked.add(sp.a.id);
      const opts = sp.opts.slice(0, 6);
      if (sp.nulls && opts.length < 7) opts.push('Otra / sin especificar');
      st.splitOpts = opts;
      const chips = opts.map((o, i) => ({ label: optLabel(o), value: o, act: { opt: i } }));
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
      chips.push({ label: 'Ninguna: crear partida nueva', value: 'ninguna', act: { create: true } });
      this.ask(text.replace(/ Dime el número\.?/, '') + ' Dime el número o el nombre; si no es ninguna, di «crear nueva».', chips, { long: true });
    }
    st_funnel(text, n, input) {
      const st = this.state;
      const a = input && input.act;
      if (!a && /^(no|no es ninguna|ninguna|ninguno|no lo se|no se)$/.test(n)) return this.noneOfThese(st.query);
      if (a && a.list) return this.askList(st.cands.slice(0, 12), 'Estas son las opciones. ¿Cuál?');
      if ((a && a.create) || /^(no[, ]+)?(ninguna|ninguno|ninguna de (esas|estas|ellas)|no es ninguna( de (esas|estas|ellas))?|no esta|no esta en la lista|crear|crea|crear nueva|crea nueva|crear( una)?( nueva)? partida( nueva)?|crea( una)?( nueva)? partida( nueva)?|partida nueva|nueva|nueva partida|creamos( una)?( nueva| partida nueva| una partida nueva)?|creala|la creamos|vamos a crearla|dictar( una)?( partida)? nueva|dictar nueva partida|otra nueva)$/.test(n)) return this.createStart(st.query, [], true);
      if (/^(ver lista|lista|leeme|lee las opciones|cuales hay|todas)/.test(n)) return this.askList(st.cands.slice(0, 12), 'Estas son las opciones. ¿Cuál?');
      if (/^(me da igual|cualquiera|la normal|la habitual|la que sea)/.test(n)) return this.pickDoc(st.cands[0].doc, 'Pongo la más habitual.', st.query);
      let i = a && a.opt !== undefined ? a.opt : matchOption(text, st.splitOpts.map(optLabel));
      if (i < 0 && !a && this.measureDuringChoice(text, n, st.cands)) return;
      if (i < 0 && this.escape(text, n)) return;
      if (i < 0) {
        // ¿Ha nombrado directamente una partida o un valor de otro atributo?
        const f = prefilter(st.cands, text);
        if (f.length < st.cands.length && f.length) { st.cands = f; return this.funnelStep(); }
        if (!contentWords(text).length || /^(si|no|vale|ok|igual|eso|esa|esta|la misma|lo mismo)\b/.test(n)) return this.ask('No te he entendido. ' + st.split.a.q(st.splitOpts.map(cap)) + ' Puedes tocar una opción.', this.lastPrompt.chips);
        const res = this.cat.index.search(st.query + ' ' + text, this.boostFn());
        const inC = res.filter((r) => st.cands.some((c) => c.doc.c === r.doc.c));
        if (inC.length && inC[0].s > (inC[1] ? inC[1].s * 1.15 : 0)) return this.propose(inC[0].doc, '', st.query, st.cands);
        if (contentWords(text).length >= 2 && res.length && res[0].s > 0.5 && !st.cands.some((c) => c.doc.c === res[0].doc.c)) return this.selectWork(text);
        return this.aiOr(text, 'respuesta no reconocida mientras se elegía partida para «' + st.query + '»', () => this.ask('No te he entendido. ' + st.split.a.q(st.splitOpts.map(cap)), this.lastPrompt.chips));
      }
      const val = st.splitOpts[i];
      const id = st.split.a.id;
      st.cands = st.cands.filter((c) => val === 'Otra / sin especificar' ? !c.doc.attrs[id] : c.doc.attrs[id] === val);
      this.funnelStep();
    }
    st_list(text, n, input) {
      const st = this.state; const a = input && input.act;
      if (!a && /^(no|no es ninguna|ninguna|ninguno|no son|no es)$/.test(n)) return this.noneOfThese(st.query);
      if ((a && a.create) || /^(no[, ]+)?(ninguna|ninguno|ninguna de (esas|estas|ellas)|no es ninguna( de (esas|estas|ellas))?|no esta|no esta en la lista|crear|crea|crear nueva|crea nueva|crear( una)?( nueva)? partida( nueva)?|crea( una)?( nueva)? partida( nueva)?|partida nueva|nueva|nueva partida|creamos( una)?( nueva| partida nueva| una partida nueva)?|creala|la creamos|vamos a crearla|dictar( una)?( partida)? nueva|dictar nueva partida|otra nueva)$/.test(n)) return this.createStart(st.query, [], true);
      let i = a && a.pick !== undefined ? a.pick : matchOption(text, st.listed.map((x) => x.short || x.doc.r));
      if (i < 0) i = matchOption(text, st.listed.map((x) => x.doc.r));
      if (i < 0 && !a && !/\b(opcion|primera|segunda|tercera|cuarta|numero|la \d)\b/.test(n) && this.measureDuringChoice(text, n, st.listed)) return;
      if (i < 0 && this.escape(text, n)) return;
      if (i < 0) {
        const res = this.cat.index.search(text, this.boostFn());
        if (contentWords(text).length >= 2 && res.length && res[0].s > 0.5 && !st.listed.some((c) => c.doc.c === res[0].doc.c)) return this.selectWork(text);
        const f = prefilter(st.listed, text);
        if (f.length === 1) return this.pickDoc(f[0].doc, '', st.query);
        if (f.length > 1 && f.length < st.listed.length) return this.askList(f, 'Quedan ' + f.length + ': ' + f.map((x, j) => (j + 1) + ', ' + x.doc.r).join('; ') + '. ¿Cuál?');
        return this.aiOr(st.query + ' — ' + text, 'respuesta no reconocida al elegir de una lista', () => this.ask('¿Cuál de ellas? Dime el número.', this.lastPrompt.chips));
      }
      this.pickDoc(st.listed[i].doc, '', st.query);
    }
    noneOfThese(query) {
      this.state = { mode: 'none', query };
      return this.ask('Vale. ¿Me la dices con otras palabras, o creamos una partida nueva con «' + query + '»?', [{ label: 'Crear partida nueva', value: 'crear nueva', act: { create: true } }, { label: 'Cancelar', value: 'cancela' }]);
    }
    st_none(text, n, input) {
      const st = this.state; const a = input && input.act;
      if ((a && a.create) || /^(si|crear|crea|crear nueva|crea nueva|creala|partida nueva|nueva|creamos( una)?( nueva)?)\b/.test(n)) return this.createStart(st.query, [], true);
      if (this.escape(text, n)) return;
      this.state = { mode: 'idle' };
      return this.selectWork(text);
    }
    /* ---- IA de respaldo ----
     * Solo cuando el motor no está seguro. Si no hay IA (sin sesión, sin conexión) o falla, se usa el plan B. */
    aiOr(frase, motivo, fallback) {
      if (!this.noAgent && this.agentReady()) return this.runAgent(frase, motivo, fallback);
      const io = this.io;
      const AIm = root.AI;
      if (!io.ai || !AIm || !io.aiReady || !io.aiReady()) return fallback();
      const key = norm(frase);
      this.aiTried = this.aiTried || new Set();
      if (this.aiTried.has(key)) return fallback();
      this.aiTried.add(key);
      const token = (this.aiToken = (this.aiToken || 0) + 1);
      const prev = this.state;
      this.state = { mode: 'thinking', prev, fallback };
      io.note && io.note('Lo consulto con la IA…');
      const act = this.active();
      const ctx = {
        obra_id: this.obra.id, frase, motivo, estancia: this.obra.estActiva || '',
        activa: act ? { ref: act.ref, r: act.r, u: act.u } : null,
        rechazadas: [...(this.rejected || [])].slice(-20),
        historial: (io.history ? io.history() : []).slice(-6),
        candidatas: AIm.candidates(this.cat, frase).map((d) => ({ c: d.c, u: d.u, r: d.r, path: d.path }))
      };
      const timer = setTimeout(() => { if (token === this.aiToken) { this.aiToken++; this.state = { mode: 'idle' }; fallback(); } }, 9000);
      Promise.resolve(io.ai(ctx)).then((raw) => {
        clearTimeout(timer);
        if (token !== this.aiToken) return;
        const r = AIm.validate(raw && raw.result ? raw.result : raw, ctx);
        this.state = { mode: 'idle' };
        this.applyAI(r, frase, fallback);
      }).catch(() => { clearTimeout(timer); if (token !== this.aiToken) return; this.state = { mode: 'idle' }; fallback(); });
    }
    /* ============================================================
     * MODO AGENTE (IA primero)
     * ============================================================ */
    agentReady() { return !!(this.io.agent && this.io.aiReady && this.io.aiReady() && root.AI); }
    /** Lo que el motor resuelve al instante sin IA: medidas sueltas y órdenes exactas. */
    isTrivial(text, n) {
      const act = this.active();
      if (/^(siguiente partida|nueva partida|otra partida|siguiente estancia|otra estancia|cambiar estancia|terminar|termina|terminado|he terminado|fin|eso es todo|lee las lineas|leer lineas|lee la partida|para|parar|stop|basta|pausa|silencio|deshacer|deshaz|atras|ayuda|repite|cancela|cancelar|resumen|no|nada|nada mas|si|vale|ok|seguir midiendo|mismas medidas|las mismas|medidas nuevas|exporta el pdf|exporta el excel|exporta el bc3|genera el pdf|compartir los archivos|comparte los archivos|envíame los archivos por correo|enviame los archivos por correo)$/.test(n)) return true;
      if (/^(?:pasamos|vamos|estamos|entramos)\s+(?:a|al|a la|en|en el|en la)\s+\S+(\s+\d+)?$/.test(n) || /^estancia\s+\S+/.test(n)) return true;
      const cw = contentWords(text);
      const GEO = /(rectangul|parte|forma|irregular|perimetro|altura|alto|ancho|largo|superficie|total|igual|mismo|aprovech|antes|anterior)/;
      if (/^(?:la\s+)?(?:altura|alto)(?:\s+es|\s+de)?\s+[\d,.\s]+(?:metros|m|centimetros|cm)?$/.test(n)) return true;
      if (/^(?:el\s+)?perimetro\b/.test(n) && tokenize(n.replace(/^(?:el\s+)?perimetro\s*(?:total|es|son|de|mide|:)?/, '')).every((x) => x.k === 'N' || /^(mas|y|con|coma|metros?|m|centimetros?|cm|de|es|total)$/.test(x.n))) return true;
      if (/^superficie\b/.test(n) && cw.filter((w) => !/superficie|total/.test(w)).length === 0) return true;
      const pm = parseMeasure(text);
      const correction = /\b(no|era|eran|corrige|corregir|cambia|cambiar|mal|equivoc|perdon|mejor|en realidad|borra|la ultima|el ultimo|la primera|el primero|segund|tercer|anterior|lo mismo|igual que|aprovecha)\b/.test(n);
      // Medida suelta ("2,40 por 3", "pared ducha 1,80 por 2,50"): sin verbos ni explicaciones
      const habla = /(grados|°|º|\bgir|izquierda|derecha|recorrido)/.test(n + text) || /\b(mide|miden|medimos|tiene|tienen|hay|son|es|era|seria|luego|tambien|despues|ademas|entonces|pues|bueno|vale|y otro|y otra|de alto|de ancho|de largo|metros de)\b/.test(n);
      if (act && pm.count >= 1 && pm.count <= 3 && !correction && !habla && cw.length <= 2 && !cw.some((w) => GEO.test(w))) return true;
      return false;
    }
    plantaDe(est) { const pl = this.obra.plantas && this.obra.plantas[norm(est || '')]; return pl || null; }
    plantaTxt(est) {
      const pl = this.plantaDe(est); if (!pl) return '';
      if (pl.abierta) return 'recorrido EN CURSO con ' + pl.tramos.length + ' paredes (' + pl.tramos.map((t) => fmt(t.l)).join(', ') + '); si dice más paredes usa "recorrido" con "continuar": true.';
      return 'cerrada, ' + (pl.tramos.length + (pl.cierre === '2' ? 2 : pl.cierre === '1' ? 1 : 0)) + ' paredes, superficie ' + fmt(pl.area) + ' m², perímetro ' + fmt(pl.perimetro) + ' m. Para usarla: "medida_planta".';
    }
    agentContext(text, pendiente) {
      const est = this.obra.estActiva || '';
      const ne = norm(est);
      const act = this.active();
      const pack = (p) => ({ ref: p.ref, r: p.r, u: p.u, orient: p.orient, total: totalOf(p), lineas: p.lineas.map((l) => ({ est: l.est, com: l.com, uds: l.uds, l: l.l, a: l.a, h: l.h, hPend: !!(l.hPend && l.h == null), p: parcial(l) })) });
      const otras = this.obra.partidas.filter((p) => p !== act && p.lineas.some((l) => norm(l.est || '') === ne)).sort((a, b) => (b.mod || 0) - (a.mod || 0)).slice(0, 6)
        .map((p) => Object.assign(pack(p), { lineas: pack(p).lineas.filter((l) => norm(l.est || '') === ne) }));
      const resto = this.obra.partidas.filter((p) => p !== act && !otras.some((o) => o.ref === p.ref)).slice(0, 30).map((p) => p.ref + ' · ' + p.r);
      return {
        obra_id: this.obra.id, frase: text, estancia: est, altura: this.alturaEst(est), planta: this.plantaTxt(est),
        activa: act ? pack(act) : null, otras, resto, pendiente: pendiente || '',
        historial: (this.io.history ? this.io.history() : []).slice(-8),
        candidatas: root.AI.candidates(this.cat, text).slice(0, 50).map((d) => ({ c: d.c, u: d.u, r: d.r, path: d.path }))
      };
    }
    runAgent(text, pendiente, fallback) {
      const io = this.io;
      const token = (this.aiToken = (this.aiToken || 0) + 1);
      const pend = pendiente || (this.state.mode !== 'idle' && this.lastPrompt ? this.lastPrompt.text : '');
      const ctx = this.agentContext(text, pend);
      this.lastAgentText = text;
      this.state = { mode: 'thinking' };
      io.note && io.note('Pensando…');
      const aviso = () => { if (!this.aiDownNoted) { this.aiDownNoted = true; io.note && io.note('La IA no responde ahora mismo; sigo en modo básico.'); } };
      const plan0 = fallback || (() => { this.noAgent = true; try { this.state = { mode: 'idle' }; this.st_idle(text, norm(text)); } finally { this.noAgent = false; } });
      const plan = () => { aviso(); plan0(); };
      const timer = setTimeout(() => { if (token === this.aiToken) { this.aiToken++; this.state = { mode: 'idle' }; plan(); } }, 20000);
      Promise.resolve(io.agent(ctx)).then((raw) => {
        clearTimeout(timer);
        if (token !== this.aiToken) return;
        const r = raw && raw.result ? raw.result : raw;
        this.state = { mode: 'idle' };
        if (!r || !Array.isArray(r.acciones)) return plan();
        this.aiDownNoted = false;
        this.applyAgent(r);
      }).catch(() => { clearTimeout(timer); if (token !== this.aiToken) return; this.state = { mode: 'idle' }; plan(); });
    }
    applyAgent(r) {
      const cat = this.cat;
      const problems = [];
      let changed = false, orden = null, touched = null, plantaMsg = null;
      this.snapshot();
      const cur = () => this.active();
      const num = (v) => (typeof v === 'number' && isFinite(v) && v > -1000 && v < 10000 ? round2(v) : null);
      // La IA no hace cuentas: escribe la operación ("2*(2.20+1.60)") y se calcula aquí
      const calc = (s) => {
        if (typeof s !== 'string' || !s.trim()) return null;
        const e = s.replace(/,/g, '.').replace(/\s+/g, '').replace(/[x×]/gi, '*');
        if (!/^[\d.+\-*/()]+$/.test(e) || e.length > 120) return null;
        try { const v = Function('"use strict";return (' + e + ')')(); return num(v); } catch (er) { return null; }
      };
      const hechas = [];
      const esHueco = /(puerta|ventana|hueco|descont|desconta|resta|menos|quita|deduc|balconera|mampara fija)/.test(norm(this.lastAgentText || '')); // líneas añadidas o cambiadas, para leerlas al usuario
      const activateDoc = (d) => {
        let p = this.obra.partidas.find((x) => x.ref === d.c);
        if (!p) {
          p = { uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ref: d.c, u: d.u, r: d.r, t: d.t, chap: d.chap, chapTitle: d.chapTitle, chapOrder: d.chapOrder, subTitle: d.subTitle, lineas: [], creada: Date.now() };
          p.orient = orientOf(p); this.obra.partidas.push(p);
        }
        this.markActivation(p, this.lastQuery, !p.lineas.length);
        this.obra.activa = p.uid; p.mod = Date.now();
        return p;
      };
      // Si la IA mete líneas dentro de otra acción (p. ej. al elegir partida), se anotan igualmente
      const acciones = [];
      for (const a of r.acciones.slice(0, 20)) {
        acciones.push(a);
        if (a.tipo !== 'anadir_lineas' && Array.isArray(a.lineas_nuevas) && a.lineas_nuevas.length) acciones.push({ tipo: 'anadir_lineas', lineas_nuevas: a.lineas_nuevas });
      }
      for (const a of acciones) {
        try {
          switch (a.tipo) {
            case 'elegir_partida': {
              if (!a.codigo) break; // acción vacía: se ignora
              const ex = this.obra.partidas.find((x) => x.ref === a.codigo);
              const d = cat.byCode.get(a.codigo);
              if (ex) { this.obra.activa = ex.uid; ex.mod = Date.now(); this.markActivation(ex, null, false); }
              else if (d) activateDoc(d);
              else problems.push('no encuentro la partida ' + a.codigo);
              break;
            }
            case 'crear_partida': {
              if (!a.descripcion || !['ud', 'm', 'm2', 'm3'].includes(a.unidad)) { problems.push('faltan datos para crear la partida'); break; }
              this.obra.propiaSeq = (this.obra.propiaSeq || 0) + 1;
              const code = 'PROPIA.' + String(this.obra.propiaSeq).padStart(3, '0');
              const res = cat.index.search(a.descripcion);
              const isDem = /demol|levant|picad|picar|quitar|retir|arranc|desmont|elimin|derrib|rascad/.test(norm(a.descripcion));
              const g = (isDem && (res.find((x) => /DEMOLIC/i.test(x.doc.chapTitle)) || {}).doc) || (res.length && res[0].s > 0.12 ? res[0].doc : null);
              const p = { uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ref: code, propia: true, u: a.unidad, r: cap(a.descripcion), t: cap(a.descripcion), chap: g ? g.chap : 'PROPIAS', chapTitle: g ? g.chapTitle : 'PARTIDAS PROPIAS', chapOrder: g ? g.chapOrder : 9999, subTitle: g ? g.subTitle : '', lineas: [], creada: Date.now() };
              p.orient = a.orientacion === 'paredes' ? 'V' : a.orientacion ? 'H' : orientOf(p);
              this.obra.partidas.push(p); this.obra.activa = p.uid; this.markActivation(p, null, true);
              break;
            }
            case 'anadir_lineas': {
              const p = cur(); if (!p) { problems.push('no hay partida para anotar las medidas'); break; }
              const hEst = this.isWall(p) ? this.alturaEst(this.obra.estActiva) : null;
              for (const ln of (a.lineas_nuevas || []).slice(0, 30)) {
                let l = calc(ln.largo_calculo) ?? num(ln.largo), w = num(ln.ancho), h = num(ln.alto), u = num(ln.uds);
                const pl = ln.medida_planta && this.plantaDe(this.obra.estActiva);
                if (pl && !pl.abierta) {
                  if (ln.medida_planta === 'superficie') { l = pl.area; w = null; h = null; }
                  else if (ln.medida_planta === 'perimetro') { l = pl.perimetro; w = null; }
                  if (!ln.comentario) ln.comentario = ln.medida_planta === 'superficie' ? 'Superficie según planta' : 'Perímetro según planta';
                } else if (ln.medida_planta) continue; // se anotará sola al cerrar la planta
                if (p.u === 'm2' && p.orient === 'V' && h == null && w != null) { h = w; w = null; }
                if (p.u === 'm2' && p.orient !== 'V' && w == null && h != null) { w = h; h = null; }
                if (p.u === 'm' || p.u === 'ud') { w = null; if (p.u === 'ud') { h = null; l = null; } }
                if (u == null) u = 1;
                u = Math.abs(u);
                // Solo se descuenta si de verdad se habla de un hueco
                if (ln.deduccion && (esHueco || /(puerta|ventana|hueco|balconera|deduc|descuento)/.test(norm(ln.comentario || '')))) u = -u;
                const nl = { id: this.nextId(p), est: this.estPrefix(), com: cap(ln.comentario || (ln.deduccion ? 'Deducción hueco' : '')), uds: u, l, a: w, h };
                if (pl && !pl.abierta && ln.medida_planta) nl.dePlanta = ln.medida_planta;
                // Altura de la estancia solo en líneas de pared (no en techos/suelos ni en superficies ya calculadas)
                const horiz = ln.medida_planta === 'superficie' || w != null || /(techo|suelo|superficie|planta|falso)/.test(norm(ln.comentario || '')) || /\btecho/.test(norm(this.lastAgentText || ''));
                if (this.isWall(p) && nl.h == null && !horiz) { if (hEst) nl.h = hEst; else nl.hPend = true; }
                p.lineas.push(nl); changed = true; touched = p; hechas.push(nl);
              }
              p.mod = Date.now();
              break;
            }
            case 'editar_linea': {
              const p = cur(); const l = p && p.lineas[(a.linea || 0) - 1];
              if (!l) { problems.push('no existe la línea ' + a.linea); break; }
              const c = a.campos || {};
              if (c.comentario != null) l.com = cap(c.comentario);
              if (num(c.uds) != null) l.uds = (l.uds < 0 ? -Math.abs(num(c.uds)) : num(c.uds));
              const nlg = calc(c.largo_calculo) ?? num(c.largo);
              if (nlg != null) { l.l = nlg; delete l.dePlanta; }
              if (num(c.ancho) != null) { if (p.u === 'm2' && p.orient === 'V') l.h = num(c.ancho); else l.a = num(c.ancho); }
              if (num(c.alto) != null) { if (p.u === 'm2' && p.orient !== 'V') l.a = num(c.alto); else { l.h = num(c.alto); delete l.hPend; } }
              p.mod = Date.now(); changed = true; touched = p; hechas.push(l);
              break;
            }
            case 'borrar_lineas': {
              const p = cur(); if (!p) break;
              [...new Set(a.lineas || [])].sort((x, y) => y - x).forEach((i) => { if (p.lineas[i - 1]) { p.lineas.splice(i - 1, 1); changed = true; } });
              touched = p; break;
            }
            case 'copiar_lineas': {
              const p = cur(); const src = this.obra.partidas.find((x) => x.ref === a.desde);
              if (!p || !src || src === p) { problems.push('no puedo copiar esas medidas'); break; }
              const est = a.solo_estancia ? this.obra.estActiva : null;
              this.muteAsk = true; try { this.copyLines(src, p, { est }); } finally { this.muteAsk = false; }
              changed = true; touched = p; break;
            }
            case 'recorrido': {
              let tr = (a.tramos || []).map((t) => ({ l: num(t.largo), giro: t.giro || '', ang: num(t.angulo) || 90 })).filter((t) => t.l && t.l > 0 && t.l < 200);
              // Los números dictados se leen aquí (la IA confunde "pared cinco cuatro metros")
              const det = parseRecorrido(this.lastAgentText || '');
              if (det) tr = det.map((d, i) => ({ l: d.l, giro: d.giro || (tr[i] && tr[i].giro) || '', ang: d.ang !== 90 ? d.ang : (tr[i] && tr[i].ang) || 90 }));
              const key = norm(this.obra.estActiva || '');
              this.obra.plantas = this.obra.plantas || {};
              const prev = this.obra.plantas[key];
              const frase = norm(this.lastAgentText || '');
              // Si había un recorrido a medias, se sigue con él salvo que diga que empieza de nuevo
              const sigue = prev && prev.abierta && (a.continuar || !/(empez|de nuevo|desde el principio|otra vez desde|borra)/.test(frase));
              const tramos = (sigue ? prev.tramos : []).concat(tr);
              if (!tramos.length) { problems.push('no he entendido las paredes'); break; }
              const res = calcPlanta(tramos);
              // Si la última pared acaba con un giro, el usuario va a seguir: solo se cierra si lo dice
              const pideCierre = /(cierr|ya esta|termin|principio|eso es todo|vuelvo al|hasta el inicio|toda la sala)/.test(frase);
              const cerrar = pideCierre || (a.cerrar && !(tr.length && tr[tr.length - 1].giro));
              const abierta = !cerrar && res.cierre !== 'exacto';
              const pl = { est: this.obra.estActiva || '', tramos, pts: res.pts.map((q) => [round2(q[0]), round2(q[1])]), area: res.area, perimetro: res.perimetro, cierre: res.cierre, supuestas: res.supuestas, aviso: res.aviso, abierta: abierta || !!res.abierta, fecha: Date.now() };
              this.obra.plantas[key] = pl;
              plantaMsg = pl;
              // Al cerrar la planta, su medida pasa a la partida activa (salvo que ya venga en esta respuesta o ya esté)
              const pa = cur();
              const yaViene = r.acciones.some((x) => x.tipo === 'anadir_lineas' && (x.lineas_nuevas || []).some((l) => l.medida_planta));
              if (!pl.abierta && pa && !yaViene && !pa.lineas.some((l) => l.dePlanta && norm(l.est || '') === key)) {
                const pared = pa.u === 'm2' && pa.orient === 'V';
                const med = pa.u === 'm' || pared ? 'perimetro' : pa.u === 'm2' ? 'superficie' : null;
                if (med) {
                  const h = pared ? this.alturaEst(this.obra.estActiva) : null;
                  const nl = { id: this.nextId(pa), est: this.estPrefix(), com: med === 'superficie' ? 'Superficie según planta' : 'Perímetro según planta', uds: 1, l: med === 'superficie' ? pl.area : pl.perimetro, a: null, h: pared ? h : null, dePlanta: med };
                  if (pared && !h) nl.hPend = true;
                  pa.lineas.push(nl); pa.mod = Date.now(); changed = true; touched = pa; hechas.push(nl);
                }
              }
              // Las líneas que salieron de la planta se actualizan con la nueva
              if (!pl.abierta) this.obra.partidas.forEach((pp) => pp.lineas.forEach((l) => {
                if (l.dePlanta && norm(l.est || '') === key) { l.l = l.dePlanta === 'superficie' ? pl.area : pl.perimetro; pp.mod = Date.now(); changed = true; }
              }));
              break;
            }
            case 'fijar_altura': {
              const v = num(a.altura); if (!v || v <= 0.3 || v >= 20) { problems.push('la altura no es válida'); break; }
              this.obra.alturas = this.obra.alturas || {}; this.obra.alturas[norm(this.obra.estActiva || '')] = v;
              this.pendingWalls(this.obra.estActiva).forEach(([pp, l]) => { l.h = v; delete l.hPend; });
              changed = true; touched = touched || cur(); break;
            }
            case 'cambiar_estancia': if (a.estancia) this.setEstancia(estanciaName(a.estancia)); break;
            case 'orden': if (a.texto) orden = a.texto; break;
          }
        } catch (e) { problems.push('error al aplicar una acción'); }
      }
      this.touch();
      if (changed) this.io.flash && this.io.flash('ok');
      let msg = (r.mensaje || '').trim();
      if (problems.length) msg += ' (No he podido: ' + problems.join('; ') + '.)';
      const p = touched || cur();
      // Si hay pregunta, el mensaje no debe adelantarla: se quitan sus frases interrogativas
      if (r.pregunta && msg) { const sinQ = msg.replace(/¿[^?]*\?/g, '').replace(/\s{2,}/g, ' ').trim(); if (sinQ) msg = sinQ; }
      if (plantaMsg) {
        const pl = plantaMsg;
        if (pl.abierta) msg += (msg ? ' ' : '') + 'Llevo ' + pl.tramos.length + (pl.tramos.length === 1 ? ' pared' : ' paredes') + ': ' + pl.tramos.map((t) => fmt(t.l)).join(', ') + '. Sigue con la siguiente, o di «cierra».';
        else {
          msg += (msg ? ' ' : '') + 'Planta: ' + fmt(pl.area) + ' metros cuadrados de superficie y ' + fmt(pl.perimetro) + ' de perímetro' +
            (pl.cierre === '1' ? ', cerrando con una pared de ' + fmt(pl.supuestas[0]) : pl.cierre === '2' ? ', cerrando con dos paredes de ' + fmt(pl.supuestas[0]) + ' y ' + fmt(pl.supuestas[1]) : '') + '.' +
            (pl.aviso ? ' Ojo: ' + pl.aviso + '.' : '');
          this.io.sketch && this.io.sketch(plantaSVG(pl), 'Planta ' + (pl.est || ''));
        }
      }
      // Se leen las medidas tal como han quedado anotadas (no las que diga la IA)
      if (hechas.length && hechas.length <= 3) {
        const d = (l) => { const dims = ['l', 'a', 'h'].filter((k) => l[k] != null).map((k) => fmt(l[k])).join(' por '); return (l.uds < 0 ? 'menos ' : '') + (l.com ? l.com.toLowerCase() + ' ' : '') + (Math.abs(l.uds || 1) !== 1 ? fmtUds(Math.abs(l.uds)) + ' de ' : '') + (dims || ''); };
        msg += (msg ? ' ' : '') + cap(hechas.map(d).join('; ')) + '.';
      } else if (hechas.length) msg += (msg ? ' ' : '') + 'Anotadas ' + hechas.length + ' líneas.';
      if (changed && p) {
        const pend = p.lineas.filter((l) => l.hPend && l.h == null).length;
        if (!msg.includes(fmt(totalOf(p)))) msg += ' Total ' + p.r.split(',')[0] + ': ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '.';
        if (pend && !r.pregunta) msg += ' Falta la altura de ' + (pend === 1 ? '1 pared' : pend + ' paredes') + '.';
      }
      if (orden) {
        this.io.note && msg && this.io.note(msg);
        const t = norm(orden);
        if (this.tryCommands(orden, t) === false) this.ask(msg || 'Hecho.', this.idleChips());
        return;
      }
      if (r.pregunta) {
        this.state = { mode: 'idle' };
        const chips = (r.opciones || []).slice(0, 5).map((o) => ({ label: cap(o), value: o }));
        return this.ask((msg ? msg + ' ' : '') + r.pregunta, chips.length ? chips : this.idleChips());
      }
      const a0 = cur();
      if (!changed && a0 && !msg) msg = 'Partida ' + a0.r + '. ' + this.dimsAsk(a0);
      this.ask(msg || 'Hecho.', this.idleChips());
    }
    st_thinking(text, n, input) {
      // Si el usuario habla mientras la IA piensa, se abandona la consulta y se atiende lo nuevo
      this.aiToken = (this.aiToken || 0) + 1;
      this.state = { mode: 'idle' };
      return this.handleInternal(text, n, input);
    }
    handleInternal(text, n, input) {
      if (input && input.act) return this.st_idle(text, n, input);
      if (this.tryCommands(text, n) === false) return this.st_idle(text, n, input);
    }
    applyAI(r, frase, fallback) {
      const cat = this.cat;
      if (r.intent === 'partida' && r.partida_codigo && cat.byCode.get(r.partida_codigo)) {
        const d = cat.byCode.get(r.partida_codigo);
        const alts = (r.alternativas || []).map((c) => cat.byCode.get(c)).filter(Boolean).map((doc) => ({ doc }));
        return this.propose(d, 'Creo que es esta.', frase, alts, true);
      }
      if (r.intent === 'crear_partida' && r.nueva_descripcion) {
        this.state = { mode: 'ai_create', query: frase, desc: cap(r.nueva_descripcion), u: r.nueva_unidad || null };
        return this.ask('No está en la base de datos. ¿Creo la partida «' + cap(r.nueva_descripcion) + '»' + (r.nueva_unidad ? ', en ' + unitSpoken(r.nueva_unidad) : '') + '?',
          [{ label: 'Sí, crearla', value: 'sí', act: { yes: true } }, { label: 'Cambiar la descripción', value: 'cambiar descripción', act: { edit: true } }, { label: 'Cancelar', value: 'cancela' }]);
      }
      if ((r.intent === 'medida' || r.intent === 'comando') && r.texto_normalizado) {
        const parts = r.texto_normalizado.split('|').map((x) => x.trim()).filter(Boolean).slice(0, 12);
        if (r.intent === 'medida' && !this.active()) return fallback();
        this.aiTried.add(norm(frase));
        parts.forEach((t) => { this.state = { mode: 'idle' }; this.handleInternal(t, norm(t)); });
        return;
      }
      if (r.intent === 'estancia' && r.estancia) return this.st_estancia(r.estancia, norm(r.estancia));
      if (r.intent === 'no_entiendo' && r.pregunta) return this.ask(r.pregunta, this.idleChips());
      return fallback();
    }
    st_ai_create(text, n, input) {
      const st = this.state; const a = input && input.act;
      if ((a && a.yes) || /^(si|vale|ok|creala|crea|de acuerdo|correcto)\b/.test(n)) {
        if (st.u) { this.state = { mode: 'create_desc', u: st.u, query: st.query }; return this.st_create_desc(st.desc, norm(st.desc), null); }
        return this.createStart(st.desc, [], true);
      }
      if ((a && a.edit) || /^(cambia|otra descripcion|no)\b/.test(n)) { this.state = { mode: 'create_unit', query: st.query }; return this.createStart(st.query, [], true); }
      if (this.escape(text, n)) return;
      return this.ask('¿Creo la partida «' + st.desc + '»?', this.lastPrompt.chips);
    }
    /** Elección automática: si está activada la confirmación, pregunta "¿Es X?" antes de medir. */
    propose(d, prefix, query, alts, forceConfirm) {
      const confirm = forceConfirm || (this.io.confirmPick ? this.io.confirmPick() : true);
      if (!confirm) return this.pickDoc(d, prefix, query);
      const others = (alts || []).filter((x) => x.doc && x.doc.c !== d.c).slice(0, 8);
      this.state = { mode: 'confirm', d, query, alts: others };
      this.ask((prefix || '') + '¿Es «' + d.r + '», en ' + unitSpoken(d.u) + '?', [{ label: 'Sí', value: 'sí', act: { yes: true } }, { label: 'No, otra', value: 'no', act: { yes: false } }, { label: 'Crear partida nueva', value: 'crear nueva', act: { create: true } }]);
    }
    st_confirm(text, n, input) {
      const st = this.state; const a = input && input.act;
      if ((a && a.create) || /^(crear|crea|crear nueva|crea nueva|partida nueva|nueva partida|creamos( una)?( nueva)?|ninguna)$/.test(n)) return this.createStart(st.query, [], true);
      let yes = a && a.yes !== undefined ? a.yes : null;
      if (yes === null) {
        if (/^(si|vale|ok|correcto|esa|eso|exacto|perfecto|de acuerdo|afirmativo|claro|sí)\b/.test(n)) yes = true;
        else if (/^(no|otra|tampoco|esa no|incorrecto|negativo|no es)\b/.test(n)) yes = false;
      }
      if (yes === null && this.agentReady() && contentWords(text).length >= 2) { this.state = { mode: 'idle' }; return this.runAgent(text, this.lastPrompt ? this.lastPrompt.text : ''); }
      if (yes === null) {
        const pm = parseMeasure(text);
        if (pm.count >= 1 && contentWords(text).length <= 3) { this.pickDoc(st.d, '', st.query); if (this.state.mode !== 'idle') this.state = { mode: 'idle' }; return this.addMeasure(pm, text); }
        if (this.escape(text, n)) return;
        if (contentWords(text).length) return this.selectWork(text);
        return this.ask('¿Es esa partida? Di sí o no.', this.lastPrompt.chips);
      }
      if (yes) return this.pickDoc(st.d, '', st.query);
      (this.rejected = this.rejected || new Set()).add(st.d.c);
      const rest = n.replace(/^(no[, ]*(es)?|otra|esa no)\s*/, '').trim();
      if (contentWords(rest).length) return this.selectWork(rest);
      if (st.alts.length) return this.askList(st.alts.slice(0, 5), 'Otras opciones: ' + shortLabels(st.alts.slice(0, 4).map((x) => x.doc.r)).map((x, i) => (i + 1) + ', ' + x).join('; ') + '. ¿Es alguna? También puedes decírmela con otras palabras.');
      this.state = { mode: 'idle' };
      return this.ask('No tengo otra parecida. Dímela con otras palabras, o di «crear nueva».', [{ label: 'Crear partida nueva', value: 'crear nueva', act: { createQ: st.query } }]);
    }
    /** Cambio manual (desde la pantalla): sustituye la partida activa por d, moviendo sus medidas. */
    replaceActive(d) {
      if (this.active()) this.prepareChange();
      this.state = { mode: 'idle' };
      return this.pickDoc(d, '', d.r);
    }
    createOwn(u, desc) {
      if (this.active()) this.prepareChange();
      this.state = { mode: 'create_desc', u, query: desc };
      return this.st_create_desc(desc, norm(desc), null);
    }
    prepareChange() {
      const act = this.active();
      if (!act) return null;
      const av = this.activation && this.activation.uid === act.uid ? this.activation : { before: new Set(act.lineas.map((l) => l.id)), query: act.r, created: false };
      const moveIds = act.lineas.filter((l) => !av.before.has(l.id)).map((l) => l.id);
      this.changing = { fromUid: act.uid, moveIds, created: av.created, fromR: act.r };
      return { act, av, moveIds };
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
        this._justCreated = true;
      }
      return this.activate(p, (prefix || '') + 'Partida ' + p.r + ', en ' + unitSpoken(p.u) + '.', query);
    }
    activate(p, msg, query) {
      const created = !!this._justCreated; this._justCreated = false;
      if (this.changing) return this.finishChange(p, created);
      this.markActivation(p, query, created);
      this.obra.activa = p.uid; p.mod = Date.now();
      if (query) this.lastQuery = query;
      this.state = { mode: 'idle' };
      this.touch();
      // ¿Mismas medidas que otra partida de esta estancia?
      const est = this.obra.estActiva;
      const auto = this.autoSame; this.autoSame = false;
      if (est && !p.lineas.some((l) => norm(l.est || '') === norm(est))) {
        const srcs = this.sameEstSources(p);
        if (srcs.length) {
          if (auto) return this.doSame(p, srcs[0], msg);
          this.state = { mode: 'same', p, srcs };
          const s0 = srcs[0];
          const tot = round2(s0.lineas.filter((l) => norm(l.est || '') === norm(est)).reduce((a, l) => a + parcial(l), 0));
          const chips = [{ label: 'Mismas medidas', value: 'mismas medidas', act: { same: 0 } }];
          if (srcs[1]) chips.push({ label: 'Las de ' + shortName(srcs[1].r), value: 'las de ' + srcs[1].r, act: { same: 1 } });
          chips.push({ label: 'Medidas nuevas', value: 'medidas nuevas', act: { same: -1 } });
          return this.ask(msg + ' ¿Mismas medidas que ' + shortName(s0.r) + ' en ' + art(est) + ' (' + fmt(tot) + ' ' + unitSpoken(s0.u) + '), o medidas nuevas?', chips);
        }
      }
      // Herencia proactiva
      const sug = this.inheritSuggestion(p, query);
      if (sug) return sug(msg);
      this.ask(msg + ' ' + this.dimsAsk(p), this.idleChips());
    }

    /** Partida medida más reciente en la estancia activa (distinta de la activa). */
    lastPartidaHere(excl) {
      const est = norm(this.obra.estActiva || '');
      return this.obra.partidas.filter((x) => x !== excl && x.lineas.some((l) => norm(l.est || '') === est)).sort((a, b) => (b.mod || 0) - (a.mod || 0))[0] || null;
    }
    /** Fuentes compatibles en la estancia activa: misma unidad y, en m², misma orientación. */
    sameEstSources(p) {
      const est = norm(this.obra.estActiva || '');
      const ok = (x) => x.uid !== p.uid && x.lineas.some((l) => norm(l.est || '') === est) && (x.u === p.u || (['m2'].includes(x.u) && ['m2'].includes(p.u))) && (p.u !== 'm2' || (x.orient || 'H') === (p.orient || 'H') || /pintura/.test(norm(p.r)));
      return this.obra.partidas.filter(ok).sort((a, b) => (b.mod || 0) - (a.mod || 0)).slice(0, 2);
    }
    doSame(p, src, msg) {
      const est = this.obra.estActiva;
      const k = this.copyLines(src, p, { est });
      this.state = { mode: 'idle' };
      const pend = p.lineas.some((l) => l.hPend && l.h == null);
      this.ask((msg ? msg + ' ' : '') + (k === 1 ? 'Copiada 1 línea' : 'Copiadas ' + k + ' líneas') + ' de ' + shortName(src.r) + '. Total ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '.' + (pend ? ' Faltan alturas.' : '') + ' ¿Siguiente partida?', [{ label: 'Añadir otra medida', value: 'otra medida' }, { label: 'Siguiente estancia', value: 'siguiente estancia' }, { label: 'Terminar', value: 'terminar' }]);
    }
    st_same(text, n, input) {
      const st = this.state; const a = input && input.act;
      let i = a && a.same !== undefined ? a.same : null;
      if (i === null) {
        if (/^(si|mismas|las mismas|iguales|igual|vale|ok|de acuerdo|copia|copialas|las mismas medidas|mismas medidas)\b/.test(n)) i = 0;
        else if (/^(no|nuevas|otras|distintas|diferentes|aparte|medidas nuevas|nueva medicion|mido|medir)\b/.test(n)) i = -1;
        else if (st.srcs[1] && /^las (de|del)\b/.test(n)) i = 1;
        else if (/^(la )?(primera|primero)$/.test(n)) i = 0;
        else if (/^(la )?(segunda|segundo)$/.test(n)) i = st.srcs[1] ? 1 : -1;
      }
      if (i === null && this.agentReady() && contentWords(text).length >= 2) { this.state = { mode: 'idle' }; return this.runAgent(text, this.lastPrompt ? this.lastPrompt.text : ''); }
      if (i === null) {
        const pm = parseMeasure(text);
        if (pm.count >= 1 && this.looksLikeMeasure(pm, text, st.p)) { this.state = { mode: 'idle' }; return this.addMeasure(pm, text); }
        if (this.escape(text, n)) return;
        if (contentWords(text).length >= 1) { const r = this.cat.index.search(text, this.boostFn()); if (r.length && r[0].s >= 0.45) { this.state = { mode: 'idle' }; return this.selectWork(text); } }
        return this.ask('¿Mismas medidas o nuevas?', this.lastPrompt.chips);
      }
      if (i < 0) { this.state = { mode: 'idle' }; return this.ask('Vale, medidas nuevas. ' + this.dimsAsk(st.p), this.idleChips()); }
      return this.doSame(st.p, st.srcs[i] || st.srcs[0], '');
    }
    /** Si el usuario dicta medidas mientras elige partida: tomamos la más probable y anotamos. */
    measureDuringChoice(text, n, cands) {
      const pm = parseMeasure(text);
      if (!(pm.count >= 1 && contentWords(text).length <= 3 && (pm.count >= 2 || pm.ded || /^[\d\s,.]+$|^(tres|dos|cuatro|cinco|seis|uno|un|siete|ocho|nueve|diez)\b/.test(n.trim())))) return false;
      const walls = !/\bpor\b/.test(n);
      // La forma de la medida indica la unidad: 2 medidas → m², 3 → m³, 1 → m (o paredes), solo un entero → ud
      const nd = pm.dims.length + Object.keys(pm.labeled).length;
      const want = nd >= 3 ? 'm3' : nd === 2 ? 'm2' : null;
      const best = (want && cands.find((c) => c.doc.u === want)) || (walls && cands.find((c) => c.doc.attrs.orient === 'vertical')) || (nd === 1 && cands.find((c) => c.doc.u === 'm')) || cands[0];
      const d = best.doc;
      let p = this.obra.partidas.find((x) => x.ref === d.c);
      if (!p) {
        this.snapshot();
        p = { uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ref: d.c, u: d.u, r: d.r, t: d.t, chap: d.chap, chapTitle: d.chapTitle, chapOrder: d.chapOrder, subTitle: d.subTitle, lineas: [], creada: Date.now() };
        p.orient = orientOf(p); this.obra.partidas.push(p);
      }
      if (this.changing) { const st0 = this.state; this.finishChange(p, !this.obra.partidas.some((x) => x !== p && x.ref === d.c) && !p.lineas.length, true); this.state = { mode: 'idle' }; this.addMeasure(pm, text); return true; }
      this.markActivation(p, this.state.query, !p.lineas.length);
      this.obra.activa = p.uid; p.mod = Date.now(); this.state = { mode: 'idle' };
      this.io.note && this.io.note('Uso «' + d.r + '». Si no es la correcta, di "borra esta partida".');
      this.addMeasure(pm, text);
      return true;
    }

    /* ---- Corregir una partida mal elegida ---- */
    markActivation(p, query, created) {
      this.activation = { uid: p.uid, before: new Set(p.lineas.map((l) => l.id)), query: query || this.lastQuery || p.r, created: !!created };
    }
    changePartida(newText) {
      const act = this.active() || (this.activation && this.obra.partidas.find((x) => x.uid === this.activation.uid));
      if (!act) return this.ask('No hay ninguna partida que cambiar. Dime el trabajo a medir.', this.idleChips());
      const { av, moveIds } = this.prepareChange();
      const mls = act.lineas.filter((l) => moveIds.includes(l.id));
      const want = act.u !== 'm2' ? null : mls.length ? (mls.some((l) => l.hPend || (l.h != null && l.a == null)) ? 'vertical' : 'horizontal') : (act.orient === 'V' ? 'vertical' : 'horizontal');
      const ord = (c) => (c.doc.attrs.orient === want ? 2 : c.doc.attrs.orient ? 0 : 1);
      const q = (newText || '').trim();
      const query = q && contentWords(q).length ? q : av.query;
      const res = this.cat.index.search(query, this.boostFn());
      const pre = moveIds.length ? 'Vale, cambio la partida y paso ' + (moveIds.length === 1 ? 'la línea medida' : 'las ' + moveIds.length + ' líneas medidas') + ' a la nueva.' : 'Vale, cambio la partida.';
      if (!res.length || res[0].s < 0.34) { this.state = { mode: 'idle' }; return this.ask(pre + ' ¿Cuál es la partida correcta? Dímela con otras palabras.', [{ label: 'Cancelar', value: 'cancela' }]); }
      const best = res[0].s;
      let cands = res.filter((r) => r.s >= best * (q ? 0.8 : 0.55) && r.doc.c !== act.ref).slice(0, 40);
      if (!cands.length) cands = res.filter((r) => r.doc.c !== act.ref).slice(0, 12);
      cands = prefilter(cands, query);
      if (want && !/techo|cielo|horizontal|suelo|pared|vertical/.test(norm(query + ' ' + q))) { const f = cands.filter((c) => ord(c) > 0); if (f.length) cands = f; cands.sort((a, b) => ord(b) - ord(a) || b.s - a.s); }
      if (!q) {
        // sin pista nueva: mostramos directamente las alternativas
        this.state = { mode: 'funnel', query, cands, asked: new Set(['orient']), ctxDone: true };
        return this.askList(cands.slice(0, 6), pre + ' Estas son las alternativas: ' + shortLabels(cands.slice(0, 4).map((x) => x.doc.r)).map((x, i) => (i + 1) + ', ' + x).join('; ') + '. ¿Cuál es? Si no está, dímela con otras palabras.');
      }
      this.state = { mode: 'funnel', query, cands, asked: new Set(), all: cands, want };
      this.lastPrompt = null;
      return this.funnelStep(pre);
    }
    finishChange(p2, created, silent) {
      const ch = this.changing; this.changing = null;
      const p1 = this.obra.partidas.find((x) => x.uid === ch.fromUid);
      this.snapshot();
      let moved = 0, warn = '';
      if (p1 && p1 !== p2) {
        const mv = p1.lineas.filter((l) => ch.moveIds.includes(l.id));
        p1.lineas = p1.lineas.filter((l) => !ch.moveIds.includes(l.id));
        mv.forEach((l) => {
          const nl = Object.assign({}, l, { id: this.nextId(p2) });
          if (p2.u === 'm2' && p1.u === 'm2' && (p2.orient === 'V') !== (p1.orient === 'V')) { const sec = l.a != null ? l.a : l.h; nl.a = p2.orient === 'V' ? null : sec; nl.h = p2.orient === 'V' ? sec : null; }
          p2.lineas.push(nl); moved++;
        });
        if (p1.u !== p2.u && moved) warn = ' Ojo: la unidad cambia de ' + unitSpoken(p1.u) + ' a ' + unitSpoken(p2.u) + ', revisa las medidas.';
        if (!p1.lineas.length && (ch.created || !this.obra.partidas.some((x) => x === p1 && x.lineas.length))) this.obra.partidas = this.obra.partidas.filter((x) => x !== p1);
      }
      this.obra.activa = p2.uid; p2.mod = Date.now();
      this.markActivation(p2, this.lastQuery, created);
      // las líneas movidas siguen contando como "de esta selección" por si hay que volver a cambiar
      this.activation.before = new Set(p2.lineas.slice(0, p2.lineas.length - moved).map((l) => l.id));
      this.state = { mode: 'idle' };
      this.touch();
      if (silent) { this.io.note && this.io.note('Cambiada a «' + p2.r + '».'); return; }
      this.ask('Cambiada: ahora es ' + p2.r + ', en ' + unitSpoken(p2.u) + '.' + (moved ? ' He pasado ' + (moved === 1 ? '1 línea' : moved + ' líneas') + '.' + (p2.lineas.some((l) => l.hPend && l.h == null) ? ' Faltan alturas.' : ' Total ' + fmt(totalOf(p2)) + ' ' + unitSpoken(p2.u) + '.') : '') + warn + ' ' + (moved ? '¿Seguimos midiendo?' : this.dimsAsk(p2)), this.idleChips());
    }

    /* ---- Herencia ---- */
    inheritSuggestion(p, query) {
      if (!['m2'].includes(p.u)) return null;
      const g = inheritGroup(p, query);
      if (g !== 'H' || p.lineas.length) return null; // paredes: se trabaja estancia a estancia ("¿mismas medidas?")
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
      if (mode === 'no') return this.ask('De acuerdo, medimos aparte. ' + this.dimsAsk(st.p), this.idleChips());
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
        if (l.hPend) nl.hPend = true;
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
    createStart(query, res, fromList) {
      this.state = { mode: 'create_unit', query, guess: res && res.length ? res[0].doc : null };
      this.ask((fromList ? 'Vamos a crear la partida nueva.' : 'No encuentro esa partida en la base de datos. Vamos a crearla.') + ' ¿En qué unidad se mide? Unidades, metros, metros cuadrados o metros cúbicos.',
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
      if (!u && contentWords(text).length >= 1) { const r = this.cat.index.search(text, this.boostFn()); if (r.length && r[0].s >= 0.34) return this.selectWork(text); }
      if (!u) return this.ask('¿Unidades, metros, metros cuadrados o metros cúbicos?', this.lastPrompt.chips);
      this.state.u = u; this.state.mode = 'create_desc';
      const q = cap(this.state.query);
      this.ask('Dicta una breve descripción, o pulsa usar "' + q + '".', [{ label: 'Usar «' + q + '»', value: q, act: { useq: true } }]);
    }
    st_create_desc(text, n, input) {
      const st = this.state;
      const desc = cap(input && input.act && input.act.useq ? st.query : text);
      if (!desc) return;
      // En m², si no está claro si es de paredes o de suelo/techo, se pregunta
      if (st.u === 'm2' && !st.orient) {
        const g = guessOrient(desc + ' ' + (st.query || ''));
        if (!g) { this.state = Object.assign({}, st, { mode: 'create_orient', desc }); return this.ask('¿Se mide en paredes, en suelo o en techo?', [{ label: 'Paredes', value: 'paredes', act: { o: 'V' } }, { label: 'Suelo', value: 'suelo', act: { o: 'H' } }, { label: 'Techo', value: 'techo', act: { o: 'H', techo: true } }]); }
        st.orient = g;
      }
      this.obra.propiaSeq = (this.obra.propiaSeq || 0) + 1;
      const code = 'PROPIA.' + String(this.obra.propiaSeq).padStart(3, '0');
      // Capítulo: el de la partida del catálogo más parecida (aunque no llegue al umbral)
      const res = this.cat.index.search(st.query + ' ' + desc, this.boostFn());
      const isDem = /demol|levant|picad|picar|quitar|retir|arranc|desmont|elimin|derrib|tirar/.test(norm(st.query + ' ' + desc));
      const g = (isDem && (res.find((r) => /DEMOLIC/i.test(r.doc.chapTitle)) || {}).doc) || (res.length && res[0].s > 0.12 ? res[0].doc : null);
      this.snapshot();
      const p = {
        uid: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ref: code, propia: true, u: st.u, r: desc, t: desc,
        chap: g ? g.chap : 'PROPIAS', chapTitle: g ? g.chapTitle : 'PARTIDAS PROPIAS', chapOrder: g ? g.chapOrder : 9999, subTitle: g ? g.subTitle : '', lineas: [], creada: Date.now()
      };
      p.orient = st.orient || orientOf(p);
      this.obra.partidas.push(p);
      this.activate(p, 'Creada la partida ' + code + ', ' + desc + ', en el capítulo ' + p.chapTitle.toLowerCase() + '.', st.query);
    }

    st_create_orient(text, n, input) {
      const st = this.state; const a = input && input.act;
      let o = a && a.o;
      if (!o) { if (/pared|paramento|vertical|muro|tabique|fachada/.test(n)) o = 'V'; else if (/suelo|techo|horizontal|pavimento|cielo|forjado|cubierta/.test(n)) o = 'H'; }
      if (!o) { if (this.escape(text, n)) return; return this.ask('¿Paredes, suelo o techo?', this.lastPrompt.chips); }
      st.orient = o; st.mode = 'create_desc';
      return this.st_create_desc(st.desc, norm(st.desc), null);
    }
    /** "Es de paredes" / "es de techo": cambia cómo se mide la partida activa. */
    setOrient(o) {
      const p = this.active();
      if (!p || p.u !== 'm2') return this.ask('Eso solo se aplica a partidas en metros cuadrados.', this.idleChips());
      if (p.orient === o) return this.ask('Ya se mide en ' + (o === 'V' ? 'paredes' : 'suelo o techo') + '. ' + this.dimsAsk(p), this.idleChips());
      this.snapshot();
      p.orient = o;
      p.lineas.forEach((l) => { const sec = l.a != null ? l.a : l.h; if (o === 'V') { l.h = sec; l.a = null; } else { l.a = sec; l.h = null; } });
      this.touch();
      this.ask('De acuerdo, ' + p.r + ' se mide en ' + (o === 'V' ? 'paredes.' : 'suelo o techo.') + ' ' + this.dimsAsk(p), this.idleChips());
    }

    /* ---- Mediciones ---- */
    nextId(p) { return p.lineas.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1; }
    addMeasure(pm, text) {
      const p = this.active();
      // Números muy grandes sin unidad: probablemente centímetros → preguntar
      // Huecos (puertas, ventanas): nunca miden más de 10 m → lo que pase de 10 son centímetros
      if (pm.ded && !pm.metros) {
        const c = (v) => (v > 10 ? round2(v / 100) : v);
        if (pm.dims.some((v) => v > 10) || Object.values(pm.labeled).some((v) => v > 10)) { pm.dims = pm.dims.map(c); Object.keys(pm.labeled).forEach((k) => { pm.labeled[k] = c(pm.labeled[k]); }); pm.cm = true; }
      }
      if (!pm.cm && !pm.metros && !this.cmOk && ['m', 'm2', 'm3'].includes(p.u)) {
        const vals = pm.dims.concat(Object.values(pm.labeled));
        const lim = p.u === 'm' ? 100 : 30;
        if (vals.length && vals.some((v) => v >= lim)) {
          const conv = vals.map((v) => fmt(v >= 10 ? v / 100 : v));
          this.state = { mode: 'cmconfirm', pm, text };
          return this.ask('¿Son centímetros? Lo anotaría como ' + conv.join(' por ') + ' metros.', [{ label: 'Sí, centímetros', value: 'sí', act: { cm: true } }, { label: 'No, son metros', value: 'no', act: { cm: false } }]);
        }
      }
      const pend0 = this.state.pending && this.state.pending.uid === p.uid ? this.state.pending : null;
      if (!pend0 && this.isWall(p) && !pm.ded && pm.labeled.h === undefined && pm.labeled.a === undefined && pm.dims.length >= 1 && !/\bpor\b|\d\s*x\s*\d/.test(norm(text))) return this.addWalls(pm);
      const pend = pend0;
      const r = buildLine(p, pm, pend ? pend.line : null);
      if (r.missing) {
        if (r.missing[0] === 'n') return this.ask('¿Cuántas unidades?');
        this.state = { mode: 'idle', pending: { uid: p.uid, line: r.pending, com: pm.comment || (pend && pend.com) || '', ded: pm.ded || (pend && pend.ded) } };
        return this.ask('Me falta ' + r.missing.map((k) => DIM_NAME[k]).join(' y ') + ', en metros.');
      }
      const line = r.line;
      const com = pm.comment || (pend && pend.com) || '';
      const ded = pm.ded || (pend && pend.ded);
      if (ded) line.uds = -Math.abs(line.uds || 1);
      this.snapshot();
      let com2 = com;
      if (!ded && !com && this.geo && this.geo.uid === p.uid && this.geo.est === (this.obra.estActiva || '')) com2 = 'Parte ' + (++this.geo.n);
      const nl = { id: this.nextId(p), est: this.estPrefix(), com: ded ? cap('Deducción ' + (com ? com.toLowerCase() : 'hueco')) : com2, uds: line.uds, l: line.l, a: line.a, h: line.h };
      if (pm.orientHint && p.u === 'm2') nl.grp = pm.orientHint;
      if (line.hueco) { nl.hueco = line.hueco; if (!nl.com) nl.com = fmt(line.hueco.a) + ' x ' + fmt(line.hueco.h); else nl.com += ' ' + fmt(line.hueco.a) + ' x ' + fmt(line.hueco.h); }
      p.lineas.push(nl); p.mod = Date.now();
      this.state = { mode: 'idle' };
      this.touch();
      const parts = [];
      if (r.warn && r.warn.length) parts.push(r.warn.join(' '));
      const dimsTxt = ['l', 'a', 'h'].filter((k) => nl[k] != null).map((k) => fmt(nl[k])).join(' por ');
      parts.push((ded ? 'Descontados ' : 'Anotado ') + (pm.cm && dimsTxt ? dimsTxt + ' metros (convertido de centímetros), ' : '') + fmt(Math.abs(parcial(nl))) + '.');
      parts.push('Total ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '.');
      const nEst = p.lineas.filter((l) => (l.est || '') === this.estPrefix()).length;
      parts.push(nEst === 1 ? 'Dime la siguiente medida, un hueco a descontar, o di "siguiente partida".' : '¿Otra medida?');
      this.io.flash && this.io.flash(ded ? 'ded' : 'ok');
      this.ask(parts.join(' '), this.idleChips(), { short: true });
    }
    addWalls(pm) {
      const p = this.active();
      const est = this.estPrefix();
      const h = this.alturaEst(est);
      const ls = (pm.labeled.l !== undefined ? [pm.labeled.l] : []).concat(pm.dims);
      this.snapshot();
      const added = ls.map((len, i) => {
        const nPrev = p.lineas.filter((l) => (l.est || '') === est && (l.uds || 1) > 0).length;
        const nl = { id: this.nextId(p), est, com: ls.length === 1 ? (pm.comment || 'Pared ' + (nPrev + 1)) : (pm.comment ? pm.comment + ' ' + (i + 1) : 'Pared ' + (nPrev + 1)), uds: pm.n !== null && ls.length === 1 ? pm.n : 1, l: len, a: null, h: h };
        if (!h) nl.hPend = true;
        p.lineas.push(nl); return nl;
      });
      p.mod = Date.now(); this.touch();
      this.io.flash && this.io.flash('ok');
      const sumL = round2(added.reduce((a, l) => a + l.l * (l.uds || 1), 0));
      if (h) return this.ask((added.length === 1 ? 'Pared de ' + fmt(added[0].l) + ' por ' + fmt(h) + ', ' + fmt(parcial(added[0])) + '.' : 'Anotadas ' + added.length + ' paredes con altura ' + fmt(h) + '.') + ' Total ' + fmt(totalOf(p)) + ' ' + unitSpoken(p.u) + '. ¿Siguiente pared?', this.idleChips(), { short: true });
      const pw = this.pendingWalls(est).length;
      this.ask((added.length === 1 ? 'Pared de ' + fmt(added[0].l) + '.' : 'Anotadas ' + added.length + ' paredes, ' + fmt(sumL) + ' metros.') + ' ¿Siguiente pared, o dime la altura de la estancia en metros?', [{ label: 'Decir la altura', value: 'altura', act: { askH: true } }].concat(this.idleChips()), { short: true });
    }
    st_cmconfirm(text, n, input) {
      const st = this.state; const a = input && input.act;
      let yes = a && a.cm !== undefined ? a.cm : /^(si|centimetros|vale|ok|correcto|eso)\b/.test(n) ? true : /^(no|metros|son metros)\b/.test(n) ? false : null;
      if (yes === null) {
        if (this.escape(text, n)) return;
        // Responde otra cosa ("me he equivocado, el largo es 2,20"): que lo interprete la IA con el contexto
        if (!this.noAgent && this.agentReady()) { this.state = { mode: 'idle' }; return this.runAgent(text, this.lastPrompt ? this.lastPrompt.text : ''); }
        return this.ask('¿Son centímetros o metros?', this.lastPrompt.chips);
      }
      const pm = st.pm;
      if (yes) {
        const c = (v) => (v >= 10 ? round2(v / 100) : v);
        pm.dims = pm.dims.map(c); Object.keys(pm.labeled).forEach((k) => { pm.labeled[k] = c(pm.labeled[k]); });
        pm.cm = true;
      }
      this.state = { mode: 'idle' };
      this.cmOk = !yes; // si dijo "metros", no volver a preguntar en esta medida
      try { return this.addMeasure(pm, st.text); } finally { this.cmOk = false; }
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
      if (!p.lineas.length) return this.ask('La partida ' + p.r + ' no tiene líneas todavía. ' + this.dimsAsk(p));
      const txt = p.lineas.map((l, i) => {
        const dims = ['l', 'a', 'h'].filter((k) => l[k] !== null && l[k] !== undefined).map((k) => fmt(l[k])).join(' por ');
        const u = l.uds !== null && l.uds !== 1 ? (l.uds < 0 ? 'menos ' + fmtUds(Math.abs(l.uds)) : fmtUds(l.uds)) + (dims ? ' de ' : ' unidades') : '';
        const lab = [l.est, l.com].filter(Boolean).join(' ');
        return 'Línea ' + (i + 1) + (lab ? ', ' + lab : '') + ': ' + u + dims + ', parcial ' + fmt(parcial(l));
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
  function optLabel(o) { return o === 'vertical' ? 'Paredes (vertical)' : o === 'horizontal' ? 'Techo (horizontal)' : cap(o); }
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
  function shortName(r) { const w = (r || '').split(/\s+/); return (w.length > 5 ? w.slice(0, 5).join(' ') : r).replace(/[,;]$/, '').toLowerCase(); }
  function art(est) {
    const n = norm(est);
    const w0 = n.split(' ')[0];
    if (/^(cocina|terraza|galeria|entrada|habitacion|escalera|azotea|cubierta|fachada|despensa|zona|planta|oficina|sala|suite|bodega|tienda|nave|piscina)/.test(n) || (/(a|ion)$/.test(w0) && !/^(dia|sofa|clima|sistema|tema|programa)$/.test(w0))) return 'la ' + est.toLowerCase();
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

  const api = { norm, words, stem, tokenize, parseMeasure, parseNumber, parseIndex, Index, prepareCatalog, bestSplit, prefilter, matchOption, orientOf, dimsSpec, buildLine, parcial, totalOf, calcPlanta, plantaSVG, parseRecorrido, inheritGroup, estanciaName, matchEstancia, ambitoFromText, Dialog, obraChapters, fmt, fmtUds, unitLabel, unitSpoken, AMBITOS, DEFAULT_ESTANCIAS, isCarpinteria, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof self !== 'undefined' ? self : this);

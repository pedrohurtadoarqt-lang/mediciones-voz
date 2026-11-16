/*
 * Parser FIEBDC-3 (BC3).
 * Conserva solo lo necesario para medir: capítulos (jerarquía), partidas
 * (código, unidad, resumen, texto) y el precio (solo para re-exportar a BC3).
 * Se descartan descompuestos (mano de obra, materiales, maquinaria, %...).
 *
 * La función parseBC3 es autocontenida (sin dependencias ni cierres) porque se
 * serializa con toString() para ejecutarse dentro de un Web Worker en línea.
 */
function parseBC3(buffer) {
  var bytes = new Uint8Array(buffer);

  // --- Detección de juego de caracteres (campo 6 de ~V: ANSI | 850 | 437) ---
  var head = '';
  for (var i = 0; i < Math.min(bytes.length, 400); i++) head += String.fromCharCode(bytes[i]);
  var vMatch = head.match(/~V\|[^~]*/);
  var charset = 'ANSI';
  if (vMatch) {
    var vf = vMatch[0].split('|');
    if (vf[5]) charset = vf[5].trim().toUpperCase();
  }
  var text;
  if (charset === '850' || charset === '437') {
    var table = charset === '850'
      ? 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00AD±‗¾¶§÷¸°¨·¹³²■\u00A0'
      : 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00A0';
    var out = [];
    for (var j = 0; j < bytes.length; j++) {
      var b = bytes[j];
      out.push(b < 128 ? String.fromCharCode(b) : table.charAt(b - 128));
    }
    text = out.join('');
  } else {
    try { text = new TextDecoder('windows-1252').decode(bytes); }
    catch (e) { text = new TextDecoder('latin1').decode(bytes); }
  }

  function cleanCode(c) { return (c || '').split('\\')[0].trim().replace(/#+$/, ''); }
  function isChapterRaw(c) { return /#$/.test((c || '').split('\\')[0].trim()); }

  var concepts = {};   // code -> {code, unit, summary, price, type, chapter, root}
  var children = {};   // code -> [childCode]
  var texts = {};      // code -> descripción larga
  var meta = { program: '', format: '', title: '', charset: charset, rootCode: '' };

  var records = text.split('~');
  for (var r = 0; r < records.length; r++) {
    var rec = records[r];
    if (rec.length < 2 || rec.charAt(1) !== '|') continue;
    var type = rec.charAt(0);
    if (type === 'T') {
      var p1 = rec.indexOf('|', 2);
      var code = cleanCode(rec.substring(2, p1));
      var body = rec.substring(p1 + 1);
      var last = body.lastIndexOf('|');
      if (last >= 0) body = body.substring(0, last);
      texts[code] = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      continue;
    }
    var flat = rec.replace(/[\r\n]/g, '');
    var f = flat.split('|');
    if (type === 'V') {
      meta.program = (f[1] || '') + (f[3] ? ' / ' + f[3] : '');
      meta.format = f[2] || '';
    } else if (type === 'C') {
      var raw = f[1] || '';
      var c = cleanCode(raw);
      if (!c) continue;
      var root = /##$/.test(raw.split('\\')[0].trim());
      var price = parseFloat(((f[4] || '').split('\\')[0] || '0').replace(',', '.')) || 0;
      concepts[c] = {
        code: c,
        unit: (f[2] || '').trim(),
        summary: (f[3] || '').trim(),
        price: price,
        type: (f[6] || '').trim(),
        chapter: isChapterRaw(raw),
        root: root
      };
      if (root) { meta.rootCode = c; meta.title = (f[3] || '').trim(); }
    } else if (type === 'D') {
      var parent = cleanCode(f[1]);
      var list = (f[2] || '').split('\\');
      var kids = [];
      for (var k = 0; k + 2 < list.length + 1; k += 3) {
        var ch = cleanCode(list[k]);
        if (ch) kids.push(ch);
      }
      children[parent] = kids;
    }
  }

  // Si no hay raíz marcada (##), tomar el primer capítulo que no sea hijo de nadie.
  if (!meta.rootCode) {
    var isChild = {};
    Object.keys(children).forEach(function (p) { children[p].forEach(function (c) { isChild[c] = 1; }); });
    for (var key in concepts) {
      if (concepts[key].chapter && !isChild[key]) { meta.rootCode = key; meta.title = concepts[key].summary; break; }
    }
  }

  // --- Construir árbol de capítulos y lista de partidas ---
  var chapters = [];   // {code, summary, parent, order, depth}
  var partidas = {};   // code -> {code, unit, summary, text, price, chapters:[...]}
  var order = 0;
  var visited = {};

  function walk(code, parentCode, depth) {
    var kids = children[code] || [];
    for (var i = 0; i < kids.length; i++) {
      var kc = kids[i];
      var con = concepts[kc];
      if (!con) continue;
      var isCh = con.chapter || ((children[kc] || []).some(function (g) { return concepts[g] && concepts[g].chapter; }));
      if (isCh) {
        if (visited['C' + kc]) continue;
        visited['C' + kc] = 1;
        chapters.push({ code: kc, summary: con.summary, parent: code === meta.rootCode ? '' : code, order: order++, depth: depth });
        walk(kc, kc, depth + 1);
      } else {
        // Partida: hijo directo de un capítulo y no es un recurso básico (%, mo, mt...).
        if (con.unit === '%' || /^[123]$/.test(con.type)) continue;
        if (!partidas[kc]) {
          partidas[kc] = { code: kc, unit: con.unit, summary: con.summary, text: texts[kc] || '', price: con.price, chapters: [], order: order++ };
        }
        if (partidas[kc].chapters.indexOf(code) < 0) partidas[kc].chapters.push(code);
      }
    }
  }
  if (meta.rootCode) {
    var rootKids = children[meta.rootCode] || [];
    // Partidas colgando directamente de la raíz -> capítulo virtual
    walk(meta.rootCode, '', 0);
  }

  var list = Object.keys(partidas).map(function (k) { return partidas[k]; });
  list.sort(function (a, b) { return a.order - b.order; });
  return { meta: meta, chapters: chapters, partidas: list };
}

if (typeof module !== 'undefined') module.exports = { parseBC3: parseBC3 };

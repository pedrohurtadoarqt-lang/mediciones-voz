/*
 * Exportación: modelo de informe jerárquico, PDF (formato listado de mediciones
 * tipo Presto/Arquímedes), BC3 con mediciones (~M) y copia de seguridad JSON.
 */
(function (global) {
  'use strict';
  var VP = global.VoiceParser;

  function fmt(v, d) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '';
    return Number(v).toLocaleString('es-ES', { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d });
  }

  /**
   * Construye el árbol Capítulo > Subcapítulo > Partida > Líneas para una visita.
   * catalog: {partidas: {code: p}, chapters: {code: c}}
   */
  function buildReport(lines, catalog) {
    var groups = {}; // chapter|code -> lines
    lines.forEach(function (ln) {
      var k = (ln.chapter || '') + '|' + ln.code;
      (groups[k] = groups[k] || []).push(ln);
    });
    var root = { code: '', children: [], kind: 'root' };
    var nodes = { '': root };

    function chapterNode(code) {
      if (nodes[code]) return nodes[code];
      var ch = catalog.chapters[code];
      var node = { kind: 'chapter', code: code, summary: ch ? ch.summary : code, order: ch ? ch.order : 1e9, children: [] };
      nodes[code] = node;
      var parent = ch && ch.parent && catalog.chapters[ch.parent] ? chapterNode(ch.parent) : root;
      parent.children.push(node);
      return node;
    }

    Object.keys(groups).forEach(function (k) {
      var ls = groups[k].slice().sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
      var chCode = k.split('|')[0];
      var code = ls[0].code;
      var p = catalog.partidas[code] || { code: code, unit: ls[0].unit || '', summary: ls[0].summary || code, text: '', order: 1e9, price: 0 };
      var parent = chCode ? chapterNode(chCode) : chapterNode('__SIN__');
      if (!chCode) { parent.summary = 'PARTIDAS SIN CAPÍTULO'; }
      var total = ls.reduce(function (a, l) { return a + VP.subtotal(l); }, 0);
      parent.children.push({ kind: 'partida', code: code, unit: p.unit, summary: p.summary, text: p.text, price: p.price, order: p.order, lines: ls, total: total });
    });

    (function sortAndNumber(node, prefix) {
      node.children.sort(function (a, b) { return a.order - b.order; });
      node.children.forEach(function (c, i) {
        c.num = (prefix ? prefix + '.' : '') + (i + 1);
        if (c.kind === 'chapter') sortAndNumber(c, c.num);
      });
    })(root, '');
    return root;
  }

  // ------------------------------------------------------------------ PDF
  function exportPDF(visita, report, opts) {
    opts = opts || {};
    var jsPDF = global.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var W = doc.internal.pageSize.getWidth();
    var H = doc.internal.pageSize.getHeight();
    var M = 12;
    var GRAY = [235, 235, 235];
    var DARK = [40, 40, 40];
    var totalPagesExp = '{total_pages_count_string}';

    var body = [];
    var meta = []; // por fila: {partida, cum}

    function push(row, info) { body.push(row); meta.push(info || null); }

    (function walk(node, depth) {
      node.children.forEach(function (c) {
        if (c.kind === 'chapter') {
          var title = depth === 0 ? 'Capítulo nº ' + c.num + '  ' + c.summary.toUpperCase() : c.num + '  ' + c.summary;
          push([{ content: title, colSpan: 9, styles: { fontStyle: 'bold', fillColor: depth === 0 ? [215, 215, 215] : GRAY, fontSize: depth === 0 ? 9.5 : 8.5 } }], { kind: 'chapter' });
          walk(c, depth + 1);
          if (depth === 0) push([{ content: '', colSpan: 9, styles: { minCellHeight: 3 } }], { kind: 'gap' });
        } else {
          var desc = c.summary + (opts.longText && c.text ? '\n' + c.text : '');
          push([
            { content: c.num, styles: { fontStyle: 'bold' } },
            { content: c.unit, styles: { fontStyle: 'bold' } },
            { content: desc, colSpan: 7, styles: { fontStyle: 'normal' } }
          ], { kind: 'partida', code: c.code, summary: c.summary });
          var cum = 0;
          c.lines.forEach(function (l) {
            var sub = VP.subtotal(l);
            cum += sub;
            push(['', '', l.label || '', fmt(l.n, 2), fmt(l.l, 2), fmt(l.a, 2), fmt(l.h, 2), fmt(sub, 2), ''], { kind: 'line', code: c.code, cum: cum, unit: c.unit });
          });
          push([
            { content: '', colSpan: 2 },
            { content: 'Total ' + c.unit + ' ............:', colSpan: 5, styles: { halign: 'right', fontStyle: 'bold' } },
            { content: fmt(c.total, 2), styles: { halign: 'right', fontStyle: 'bold' } },
            { content: fmt(c.total, 2), styles: { halign: 'right', fontStyle: 'bold' } }
          ], { kind: 'ptotal', code: c.code });
        }
      });
    })(report, 0);

    var lastDrawn = null;

    function header() {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor.apply(doc, DARK);
      doc.text('MEDICIONES', M, 14);
      doc.setFontSize(9);
      doc.text(visita.nombre || 'Visita de obra', M, 19.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      var sub = [visita.direccion, visita.tecnico ? 'Técnico: ' + visita.tecnico : '', visita.fecha ? 'Fecha: ' + new Date(visita.fecha).toLocaleDateString('es-ES') : ''].filter(Boolean).join('   ·   ');
      doc.text(sub, M, 23.5);
      if (opts.catalogTitle) doc.text('Base de precios: ' + opts.catalogTitle, W - M, 14, { align: 'right' });
      doc.setDrawColor(0); doc.setLineWidth(0.4); doc.line(M, 26, W - M, 26);
    }

    doc.autoTable({
      startY: 28,
      margin: { top: 28, left: M, right: M, bottom: 16 },
      head: [['Nº', 'Ud', 'Descripción', 'Uds.', 'Largo', 'Ancho', 'Alto', 'Parcial', 'Medición']],
      body: body,
      theme: 'plain',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 7.8, cellPadding: { top: 0.7, bottom: 0.7, left: 1, right: 1 }, textColor: DARK, overflow: 'linebreak', valign: 'top' },
      headStyles: { fontStyle: 'bold', fillColor: [255, 255, 255], lineWidth: { bottom: 0.3 }, lineColor: [0, 0, 0], halign: 'center' },
      columnStyles: {
        0: { cellWidth: 13 }, 1: { cellWidth: 9 }, 2: { cellWidth: 'auto' },
        3: { cellWidth: 13, halign: 'right' }, 4: { cellWidth: 15, halign: 'right' }, 5: { cellWidth: 15, halign: 'right' },
        6: { cellWidth: 15, halign: 'right' }, 7: { cellWidth: 17, halign: 'right' }, 8: { cellWidth: 19, halign: 'right' }
      },
      didParseCell: function (d) {
        if (d.section !== 'body') return;
        var info = meta[d.row.index];
        if (info && info.kind === 'line' && d.column.index === 2) d.cell.styles.fontStyle = 'italic';
        if (info && info.kind === 'ptotal') {
          d.cell.styles.lineWidth = { top: 0.2 }; d.cell.styles.lineColor = [120, 120, 120];
          if (d.column.index === 7) { d.cell.text = ['']; }
        }
        if (info && info.kind === 'chtotal') { d.cell.styles.cellPadding = { top: 1, bottom: 3, left: 1, right: 1 }; }
      },
      willDrawCell: function (d) {
        if (d.section === 'body') lastDrawn = meta[d.row.index];
      },
      didDrawPage: function (d) {
        header();
        // "Suma y sigue" cuando una partida continúa en la página siguiente
        if (lastDrawn && lastDrawn.kind === 'line' && d.cursor) {
          var next = meta[meta.indexOf(lastDrawn) + 1];
          if (next && (next.kind === 'line' || next.kind === 'ptotal') && next.code === lastDrawn.code) {
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8);
            doc.text('Suma y sigue ............: ' + fmt(lastDrawn.cum, 2), W - M - 1, d.cursor.y + 4, { align: 'right' });
          }
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(M, H - 11, W - M, H - 11);
        doc.text('Medición tomada a pie de obra' + (visita.fecha ? ' · ' + new Date(visita.fecha).toLocaleDateString('es-ES') : ''), M, H - 7);
        var str = 'Página ' + doc.internal.getNumberOfPages();
        if (typeof doc.putTotalPages === 'function') str += ' de ' + totalPagesExp;
        doc.text(str, W - M, H - 7, { align: 'right' });
      }
    });

    if (typeof doc.putTotalPages === 'function') doc.putTotalPages(totalPagesExp);
    var fname = 'Mediciones_' + (visita.nombre || 'visita').replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, '_') + '.pdf';
    doc.save(fname);
  }

  // ------------------------------------------------------------------ BC3
  function encodeCP1252(str) {
    var map = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i), ch = str.charAt(i);
      out[i] = c < 256 ? c : (map[ch] || 63);
    }
    return out;
  }

  function bc3Clean(s) { return String(s || '').replace(/[~|\\]/g, ' '); }
  function num(v) { return v === null || v === undefined || v === '' ? '' : String(Math.round(Number(v) * 1000) / 1000); }

  function exportBC3(visita, report, catalogMeta) {
    var rootCode = ('VISITA_' + (visita.nombre || 'OBRA')).toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 20);
    var out = [];
    var d = new Date();
    var date = ('0' + d.getDate()).slice(-2) + ('0' + (d.getMonth() + 1)).slice(-2) + String(d.getFullYear()).slice(-2);
    out.push('~V|' + bc3Clean('Medición por voz') + '|FIEBDC-3/2016|Medicion-voz|' + date + '|ANSI|Presupuesto|2|');
    out.push('~K|\\2\\2\\3\\2\\2\\2\\2\\EUR\\|0|');
    out.push('~C|' + rootCode + '##||' + bc3Clean(visita.nombre || 'Visita de obra') + '|0|' + date + '|0|');

    var chapterCodes = {}; var partidaDone = {};
    function chCode(node) { return node.code === '__SIN__' ? 'SINCAP' : node.code; }

    function walk(node, parentCode) {
      var kids = [];
      node.children.forEach(function (c) {
        if (c.kind === 'chapter') {
          var cc = chCode(c);
          kids.push(cc + '#\\1\\1');
          if (!chapterCodes[cc]) { chapterCodes[cc] = 1; out.push('~C|' + cc + '#||' + bc3Clean(c.summary) + '|0||0|'); }
          walk(c, cc + '#');
        } else {
          kids.push(c.code + '\\1\\' + num(c.total));
          if (!partidaDone[c.code]) {
            partidaDone[c.code] = 1;
            out.push('~C|' + c.code + '|' + bc3Clean(c.unit) + '|' + bc3Clean(c.summary) + '|' + num(c.price || 0) + '||0|');
            if (c.text) out.push('~T|' + c.code + '|' + bc3Clean(c.text).replace(/\n/g, '\r\n') + '|');
          }
          var lines = c.lines.map(function (l) {
            return '\\' + bc3Clean(l.label || '') + '\\' + num(l.n) + '\\' + num(l.l) + '\\' + num(l.a) + '\\' + num(l.h) + '\\';
          }).join('');
          out.push('~M|' + parentCode.replace(/#+$/, '') + '\\' + c.code + '||' + num(c.total) + '|' + lines + '|');
        }
      });
      out.push('~D|' + parentCode + '|' + kids.map(function (k) { return k + '\\'; }).join('') + '|');
    }
    walk(report, rootCode + '##');
    var text = out.join('\r\n') + '\r\n';
    download(encodeCP1252(text), (visita.nombre || 'visita').replace(/[^\w-]+/g, '_') + '_mediciones.bc3', 'application/octet-stream');
  }

  function download(data, name, mime) {
    var blob = new Blob([data], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  global.Exporter = { buildReport: buildReport, exportPDF: exportPDF, exportBC3: exportBC3, download: download, fmt: fmt };
})(window);

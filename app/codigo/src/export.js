/* ============================================================
 * EXPORTADORES: BC3 (FIEBDC-3/2016 con mediciones ~M) y Excel (.xlsx)
 * Sin librerías externas: el .xlsx se genera como ZIP + XML (OOXML).
 * ============================================================ */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  /* ---------------- Utilidades ---------------- */
  // Codificación Windows-1252 (ANSI), que es lo que esperan Presto y Arquímedes
  const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function encodeCp1252(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      out[i] = c < 0x80 || (c >= 0xA0 && c <= 0xFF) ? c : (CP1252[c] || 0x3F);
    }
    return out;
  }
  const num = (v, d) => (v === null || v === undefined || isNaN(v)) ? '' : String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
  // Los separadores del formato no pueden aparecer dentro de los campos
  const clean = (s) => String(s ?? '').replace(/[|~\\]/g, '/').replace(/\r?\n/g, ' ').trim();
  const cleanT = (s) => String(s ?? '').replace(/[|~]/g, '/').replace(/\\/g, '/').replace(/\r?\n/g, '\r\n').trim();
  function ddmmyyyy(d) { return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + d.getFullYear(); }
  function ddmmyy(d) { return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + String(d.getFullYear()).slice(2); }
  const UNIT_BC3 = { ud: 'u', m: 'm', m2: 'm2', m3: 'm3', kg: 'kg', t: 't', l: 'l' };

  /** Capítulos y partidas con mediciones, en el orden y numeración de obra. */
  function structure(obra) {
    return E.obraChapters(obra).map((c) => Object.assign({}, c, { partidas: c.partidas.filter((p) => p.lineas.length) })).filter((c) => c.partidas.length);
  }
  /** Código de partida único dentro del BC3: el del catálogo (enlaza con los precios de la base). */
  function partCodes(caps) {
    const used = new Set(), map = new Map();
    caps.forEach((c) => c.partidas.forEach((p) => {
      let code = clean(p.ref || p.codigo).replace(/#/g, '') || ('P' + p.codigo.replace('.', ''));
      let k = code, i = 2;
      while (used.has(k)) k = code + '_' + i++;
      used.add(k); map.set(p, k);
    }));
    return map;
  }
  function lineComment(l) {
    return clean([l.est, l.com].filter(Boolean).join(' - ')) || '';
  }

  /* ============================================================
   * BC3 — FIEBDC-3/2016
   * ~V cabecera, ~K decimales, ~C conceptos, ~D descomposición,
   * ~T textos, ~M líneas de medición. Sin precios (importe 0).
   * ============================================================ */
  function buildBC3(obra, opts) {
    opts = opts || {};
    const now = new Date();
    const caps = structure(obra);
    const pc = partCodes(caps);
    const rootCode = (clean(obra.titulo).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 14) || 'OBRA') + '##';
    const R = [];
    R.push('~V|' + clean(opts.propietario || '') + '|FIEBDC-3/2016\\' + ddmmyyyy(now) + '|Mediciona|' + clean(obra.titulo) + '\\|ANSI|Estado de mediciones sin precios|2|||');
    R.push('~K|-9\\2\\3\\3\\2\\2\\2\\2\\EUR\\|0\\13\\6\\\\21|3\\2\\\\3\\3\\\\2\\2\\2\\-9\\2\\3\\3\\2\\EUR\\||');
    // Raíz
    R.push('~C|' + rootCode + '||' + clean(obra.titulo) + '|0|' + ddmmyy(now) + '|0|');
    const txtObra = [obra.cliente ? 'Cliente: ' + obra.cliente : '', obra.ubicacion ? 'Ubicación: ' + obra.ubicacion : ''].filter(Boolean).join('\r\n');
    if (txtObra) R.push('~T|' + rootCode + '|' + cleanT(txtObra) + '|');
    R.push('~D|' + rootCode + '|' + caps.map((c) => c.codigo + '#\\1\\1\\').join('') + '|');
    caps.forEach((c, ci) => {
      const cc = c.codigo + '#';
      R.push('~C|' + cc + '||' + clean(c.titulo) + '|0|' + ddmmyy(now) + '|0|');
      R.push('~D|' + cc + '|' + c.partidas.map((p) => pc.get(p) + '\\1\\' + num(E.totalOf(p), 3) + '\\').join('') + '|');
      c.partidas.forEach((p, pi) => {
        const code = pc.get(p);
        R.push('~C|' + code + '|' + (UNIT_BC3[p.u] || p.u) + '|' + clean(p.r) + '|0|' + ddmmyy(now) + '|0|');
        if (p.t) R.push('~T|' + code + '|' + cleanT(p.t) + '|');
        const lines = p.lineas.map((l) => {
          const pend = l.hPend && (l.h === null || l.h === undefined);
          // TIPO \ COMENTARIO \ UNIDADES \ LONGITUD \ LATITUD \ ALTURA
          return '\\' + lineComment(l) + (pend ? ' (falta altura)' : '') + '\\' + num(l.uds, 3) + '\\' + num(l.l, 3) + '\\' + num(l.a, 3) + '\\' + num(pend ? 0 : l.h, 3);
        }).join('\\') + '\\';
        R.push('~M|' + cc + '\\' + code + '|' + (ci + 1) + '\\' + (pi + 1) + '\\|' + num(E.totalOf(p), 3) + '|' + lines + '|');
      });
    });
    return encodeCp1252(R.join('\r\n') + '\r\n');
  }

  /* ============================================================
   * XLSX mínimo: Código | Capítulo | Descripción | Uds | Largo | Ancho | Alto | Total
   * ============================================================ */
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  /** ZIP sin compresión (método "store"): suficiente y válido para .xlsx. */
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  const xesc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

  function buildXLSX(obra) {
    const caps = structure(obra);
    const rows = []; // cada fila: { style, cells: [ {v, t:'s'|'n'|'f', f, s} ] }
    // Estilos: 0 normal, 1 cabecera, 2 número 0.00, 3 partida (negrita), 4 total partida (negrita 0.00), 5 capítulo, 6 deducción 0.00, 7 texto gris (línea)
    rows.push({ cells: ['Código', 'Capítulo', 'Descripción', 'Uds', 'Largo', 'Ancho', 'Alto', 'Total'].map((v) => ({ v, t: 's', s: 1 })) });
    caps.forEach((c) => {
      const capName = c.codigo + ' ' + c.titulo;
      rows.push({ cells: [{ v: c.codigo, t: 's', s: 5 }, { v: capName, t: 's', s: 5 }, { v: c.titulo, t: 's', s: 5 }, { e: 1, s: 5 }, { e: 1, s: 5 }, { e: 1, s: 5 }, { e: 1, s: 5 }, { e: 1, s: 5 }] });
      c.partidas.forEach((p) => {
        const pRow = rows.length + 1;
        const first = pRow + 1, last = pRow + p.lineas.length;
        rows.push({ cells: [{ v: p.codigo, t: 's', s: 3 }, { v: capName, t: 's', s: 3 }, { v: p.r + ' (' + E.unitLabel(p.u) + ')' + (p.propia ? ' [partida propia]' : ' [' + p.ref + ']'), t: 's', s: 3 }, null, null, null, null,
          { t: 'f', f: 'SUM(H' + first + ':H' + last + ')', v: E.totalOf(p), s: 4 }] });
        p.lineas.forEach((l) => {
          const r = rows.length + 1;
          const pend = l.hPend && (l.h === null || l.h === undefined);
          const neg = (l.uds || 0) < 0;
          const n = (v) => (v === null || v === undefined) ? null : { v, t: 'n', s: neg ? 6 : 2 };
          const f = pend ? { v: 0, t: 'n', s: 2 } : { t: 'f', f: 'IF(D' + r + '="",1,D' + r + ')*IF(E' + r + '="",1,E' + r + ')*IF(F' + r + '="",1,F' + r + ')*IF(G' + r + '="",1,G' + r + ')', v: E.parcial(l), s: neg ? 6 : 2 };
          rows.push({ cells: [{ v: p.codigo, t: 's', s: 7 }, { v: capName, t: 's', s: 7 }, { v: lineComment(l) || '-', t: 's', s: 0 },
            l.uds === null || l.uds === undefined ? null : { v: l.uds, t: 'n', s: 0 }, n(l.l), n(l.a), pend ? { v: 'falta', t: 's', s: 7 } : n(l.h), f] });
        });
      });
    });
    const cellXml = (c, ci, ri) => {
      if (!c) return '';
      const ref = COLS[ci] + ri;
      if (c.e) return '<c r="' + ref + '" s="' + (c.s || 0) + '"/>';
      if (c.t === 's') return '<c r="' + ref + '" t="inlineStr" s="' + (c.s || 0) + '"><is><t xml:space="preserve">' + xesc(c.v) + '</t></is></c>';
      if (c.t === 'f') return '<c r="' + ref + '" s="' + (c.s || 0) + '"><f>' + xesc(c.f) + '</f><v>' + (Math.round(c.v * 1000) / 1000) + '</v></c>';
      return '<c r="' + ref + '" s="' + (c.s || 0) + '"><v>' + c.v + '</v></c>';
    };
    const sheetRows = rows.map((r, i) => '<row r="' + (i + 1) + '">' + r.cells.map((c, ci) => cellXml(c, ci, i + 1)).join('') + '</row>').join('');
    const widths = [9, 30, 60, 8, 10, 10, 10, 12];
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' +
      '<sheetData>' + sheetRows + '</sheetData>' +
      '<autoFilter ref="A1:H' + rows.length + '"/>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      '</worksheet>';
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><sz val="10"/><color rgb="FF64748B"/><name val="Arial"/></font></fonts>' +
      '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill></fills>' +
      '<borders count="2"><border/><border><top style="thin"><color rgb="FF94A3B8"/></top></border></borders>' +
      '<cellStyleXfs count="1"><xf/></cellStyleXfs>' +
      '<cellXfs count="8">' +
      '<xf fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
      '<xf fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>' +
      '<xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1"/>' +
      '<xf fontId="2" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
      '<xf fontId="2" fillId="0" borderId="1" numFmtId="164" applyFont="1" applyBorder="1" applyNumberFormat="1"/>' +
      '<xf fontId="2" fillId="3" borderId="0" applyFont="1" applyFill="1"/>' +
      '<xf fontId="0" fillId="0" borderId="0" numFmtId="164" applyNumberFormat="1"/>' +
      '<xf fontId="3" fillId="0" borderId="0" applyFont="1"/>' +
      '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
    const title = xesc(obra.titulo).slice(0, 200);
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Mediciones · ' + title + '</dc:title><dc:creator>Mediciona</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + 'Z</dcterms:created></cp:coreProperties>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Mediciones" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Mediciones!$A$1:$H$' + rows.length + '</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">Mediciones!$1:$1</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: styles },
      { name: 'xl/worksheets/sheet1.xml', data: sheet }
    ];
    return zip(files);
  }

  const api = { buildBC3, buildXLSX, encodeCp1252, zip, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Exporters = api;
})(typeof self !== 'undefined' ? self : this);

/* Aplicación principal: estado, vistas, voz y persistencia. */
(function () {
  'use strict';
  var VP = window.VoiceParser, Ex = window.Exporter, Sp = window.Speech;
  var $ = function (id) { return document.getElementById(id); };
  var norm = function (s) { return VP.stripAccents(String(s || '').toLowerCase()); };
  var uid = function () { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); };

  var S = {
    catalog: null,        // {meta, partidas:{}, chapters:{}, list:[], kids:{}}
    index: [],
    visitas: [],
    visita: null,
    lines: [],
    current: null,        // {code, chapter}
    choices: [],          // resultados para "opción N"
    settings: { engine: 'webspeech', tts: true, wake: true, longText: false },
    engine: null,
    listening: false,
    wakeLock: null,
    lastAdded: null
  };

  // ------------------------------------------------------------ utilidades UI
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    window.scrollTo(0, 0);
    if (name === 'visita') renderSummary();
    if (name === 'catalogo') renderCatalog();
  }
  function parseNum(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  function numInput(v) { return v === null || v === undefined ? '' : String(Math.round(v * 1000) / 1000).replace('.', ','); }

  // ------------------------------------------------------------ catálogo
  function setCatalog(meta, partidas, chapters) {
    var c = { meta: meta, partidas: {}, chapters: {}, list: partidas.slice().sort(function (a, b) { return a.order - b.order; }), chapterList: chapters.slice().sort(function (a, b) { return a.order - b.order; }), kids: {} };
    partidas.forEach(function (p) { c.partidas[p.code] = p; });
    chapters.forEach(function (ch) { c.chapters[ch.code] = ch; });
    c.chapterList.forEach(function (ch) { (c.kids[ch.parent || ''] = c.kids[ch.parent || ''] || []).push({ t: 'c', o: ch }); });
    c.list.forEach(function (p) { p.chapters.forEach(function (chc) { (c.kids[chc] = c.kids[chc] || []).push({ t: 'p', o: p }); }); });
    Object.keys(c.kids).forEach(function (k) { c.kids[k].sort(function (a, b) { return a.o.order - b.o.order; }); });
    S.catalog = c;
    S.index = c.list.map(function (p) {
      return { p: p, code: norm(p.code), sum: norm(p.summary), text: norm(p.text), words: norm(p.summary + ' ' + p.text).split(/[^a-z0-9ñ]+/) };
    });
    $('catalogName').textContent = meta.title || 'Base de precios';
    $('catalogInfo').textContent = (meta.title || '') + ' · ' + c.list.length + ' partidas en ' + c.chapterList.length + ' capítulos · ' + (meta.program || '') + ' ' + (meta.format || '');
  }

  function chapterPath(code) {
    var out = [], ch = S.catalog && S.catalog.chapters[code], guard = 0;
    while (ch && guard++ < 20) { out.unshift(ch.summary); ch = S.catalog.chapters[ch.parent]; }
    return out;
  }

  function lev1(a, b) { // ¿distancia de edición <= 1?
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  }

  function search(q, limit) {
    q = norm(q).trim();
    if (!q || !S.catalog) return [];
    var terms = q.split(/\s+/).filter(function (t) { return t.length > 1 && !/^(de|del|la|el|los|las|con|en|y|para|por)$/.test(t); });
    if (!terms.length) terms = [q];
    var res = [];
    S.index.forEach(function (it) {
      var score = 0;
      if (it.code === q) score += 100;
      else if (it.code.indexOf(q) === 0) score += 40;
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i], s = 0;
        if (it.sum.indexOf(t) >= 0) s = (new RegExp('(^|[^a-z0-9ñ])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(it.sum)) ? 6 : 4;
        else if (it.text.indexOf(t) >= 0) s = 2;
        else if (t.length > 4 && it.words.some(function (w) { return w.length > 3 && lev1(w, t); })) s = 1; // tolerancia a errores
        else if (it.code.indexOf(t) >= 0) s = 3;
        if (!s) { score = 0; break; }
        score += s;
      }
      if (score) res.push({ p: it.p, score: score });
    });
    res.sort(function (a, b) { return b.score - a.score || a.p.order - b.p.order; });
    return res.slice(0, limit || 60).map(function (r) { return r.p; });
  }

  function totalsByCode() {
    var t = {};
    S.lines.forEach(function (l) { t[l.code] = (t[l.code] || 0) + VP.subtotal(l); });
    return t;
  }

  function partidaItem(p, onPick, totals) {
    var tot = totals && totals[p.code];
    return el('li', { onclick: function () { onPick(p); } }, [
      el('span', { class: 'code', text: p.code }),
      el('span', { class: 'txt' }, [el('span', { text: p.summary }), el('span', { class: 'sub', text: p.unit + (p.chapters[0] ? ' · ' + chapterPath(p.chapters[0]).join(' › ') : '') })]),
      tot !== undefined ? el('span', { class: 'badge', text: Ex.fmt(tot) + ' ' + p.unit }) : null
    ]);
  }

  function renderCatalog() {
    var has = !!(S.catalog && S.catalog.list.length);
    $('catalogEmpty').classList.toggle('hidden', has);
    $('searchInput').disabled = !has;
    if (!has) { $('tree').innerHTML = ''; $('searchResults').classList.add('hidden'); return; }
    var q = $('searchInput').value;
    var totals = totalsByCode();
    if (q.trim()) {
      var res = search(q, 80);
      var ul = $('searchResults'); ul.innerHTML = '';
      if (!res.length) ul.appendChild(el('li', { class: 'hint', text: 'Sin resultados para «' + q + '»' }));
      res.forEach(function (p) { ul.appendChild(partidaItem(p, function (pp) { selectPartida(pp.code, null); showView('medir'); }, totals)); });
      ul.classList.remove('hidden'); $('tree').classList.add('hidden');
    } else {
      $('searchResults').classList.add('hidden'); $('tree').classList.remove('hidden');
      if (!$('tree').dataset.built) buildTree();
      else refreshTreeBadges(totals);
    }
  }

  function buildTree() {
    var tree = $('tree'); tree.innerHTML = ''; tree.dataset.built = '1';
    (S.catalog.kids[''] || []).forEach(function (k) { if (k.t === 'c') tree.appendChild(chapterNode(k.o, 0)); });
  }
  function chapterNode(ch, depth) {
    var wrap = el('div', { class: 'chap', 'data-depth': depth, 'data-code': ch.code });
    var kids = el('div', { class: 'kids hidden' });
    var btn = el('button', { type: 'button', onclick: function () {
      var open = wrap.classList.toggle('open');
      kids.classList.toggle('hidden', !open);
      if (open && !kids.dataset.built) {
        kids.dataset.built = '1';
        var totals = totalsByCode();
        (S.catalog.kids[ch.code] || []).forEach(function (k) {
          if (k.t === 'c') kids.appendChild(chapterNode(k.o, depth + 1));
          else {
            var li = partidaItem(k.o, function (p) { selectPartida(p.code, ch.code); showView('medir'); }, totals);
            li.className = 'pitem'; li.dataset.code = k.o.code;
            kids.appendChild(li);
          }
        });
      }
    } }, [el('span', { class: 'arrow', text: '›' }), el('span', { text: ch.code + '  ' + ch.summary })]);
    wrap.appendChild(btn); wrap.appendChild(kids);
    return wrap;
  }
  function refreshTreeBadges(totals) {
    document.querySelectorAll('#tree .pitem').forEach(function (li) {
      var b = li.querySelector('.badge'), t = totals[li.dataset.code], p = S.catalog.partidas[li.dataset.code];
      if (t === undefined) { if (b) b.remove(); return; }
      if (!b) { b = el('span', { class: 'badge' }); li.appendChild(b); }
      b.textContent = Ex.fmt(t) + ' ' + p.unit;
    });
  }

  function loadBC3File(file) {
    var prog = $('bc3Progress'); prog.classList.remove('hidden'); prog.removeAttribute('value');
    file.arrayBuffer().then(function (buf) {
      return new Promise(function (resolve, reject) {
        var src = parseBC3.toString() + '\nonmessage=function(e){try{postMessage({ok:true,r:parseBC3(e.data)})}catch(err){postMessage({ok:false,e:String(err)})}};';
        var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        var w;
        try { w = new Worker(url); } catch (e) { return resolve(parseBC3(buf)); } // sin worker: hilo principal
        w.onmessage = function (ev) { w.terminate(); URL.revokeObjectURL(url); ev.data.ok ? resolve(ev.data.r) : reject(new Error(ev.data.e)); };
        w.onerror = function (ev) { w.terminate(); reject(new Error(ev.message)); };
        w.postMessage(buf, [buf]);
      });
    }).then(function (r) {
      if (!r.partidas.length) throw new Error('No se han encontrado partidas en el archivo.');
      r.meta.fileName = file.name;
      return DB.replaceCatalog(r).then(function () { return r; });
    }).then(function (r) {
      setCatalog(r.meta, r.partidas, r.chapters);
      $('tree').dataset.built = '';
      prog.classList.add('hidden');
      toast('Cargadas ' + r.partidas.length + ' partidas de «' + r.meta.title + '»');
      renderAll();
    }).catch(function (e) {
      prog.classList.add('hidden');
      toast('Error al leer el BC3: ' + e.message, 5000);
    });
  }

  // ------------------------------------------------------------ visitas
  function newVisita() {
    var v = { id: uid(), nombre: 'Visita ' + new Date().toLocaleDateString('es-ES'), direccion: '', tecnico: '', fecha: new Date().toISOString().slice(0, 10), notas: '', created: Date.now() };
    return DB.put('visitas', v).then(function () { S.visitas.push(v); return switchVisita(v.id); });
  }
  function switchVisita(id) {
    var v = S.visitas.filter(function (x) { return x.id === id; })[0];
    if (!v) return Promise.resolve();
    S.visita = v;
    return DB.kvSet('currentVisita', id).then(function () { return DB.byIndex('lineas', 'visita', id); }).then(function (lines) {
      S.lines = lines.sort(function (a, b) { return (a.pos || 0) - (b.pos || 0); });
      return DB.kvGet('current:' + id);
    }).then(function (cur) {
      S.current = cur && S.catalog && S.catalog.partidas[cur.code] ? cur : null;
      renderAll();
    });
  }
  function saveVisita() {
    var v = S.visita; if (!v) return;
    v.nombre = $('vNombre').value.trim() || 'Visita'; v.direccion = $('vDireccion').value; v.tecnico = $('vTecnico').value;
    v.fecha = $('vFecha').value; v.notas = $('vNotas').value;
    DB.put('visitas', v); renderVisitaHeader();
    if (v.tecnico) DB.kvSet('lastTecnico', v.tecnico);
  }
  function renderVisitaHeader() {
    $('visitaNombre').textContent = S.visita ? S.visita.nombre : 'Visita';
    var sel = $('visitaSelect'); sel.innerHTML = '';
    S.visitas.slice().sort(function (a, b) { return b.created - a.created; }).forEach(function (v) {
      var o = el('option', { value: v.id, text: v.nombre }); if (S.visita && v.id === S.visita.id) o.selected = true; sel.appendChild(o);
    });
    if (S.visita) {
      $('vNombre').value = S.visita.nombre || ''; $('vDireccion').value = S.visita.direccion || '';
      $('vTecnico').value = S.visita.tecnico || ''; $('vFecha').value = S.visita.fecha || ''; $('vNotas').value = S.visita.notas || '';
    }
  }

  // ------------------------------------------------------------ partida actual y líneas
  function selectPartida(code, chapter) {
    var p = S.catalog && S.catalog.partidas[code];
    if (!p) return;
    if (!chapter) {
      var existing = S.lines.filter(function (l) { return l.code === code; })[0];
      chapter = existing ? existing.chapter : p.chapters[0];
    }
    S.current = { code: code, chapter: chapter || '' };
    S.choices = [];
    $('searchOverlay').classList.add('hidden');
    DB.kvSet('current:' + S.visita.id, S.current);
    renderMedir();
  }
  function currentLines() {
    if (!S.current) return [];
    return S.lines.filter(function (l) { return l.code === S.current.code && (l.chapter || '') === (S.current.chapter || ''); });
  }
  function addLine(data, fromVoice) {
    if (!S.current) { toast('Primero elige una partida'); return null; }
    var p = S.catalog.partidas[S.current.code];
    var maxPos = S.lines.reduce(function (a, l) { return Math.max(a, l.pos || 0); }, 0);
    var line = { id: uid(), visitaId: S.visita.id, code: p.code, chapter: S.current.chapter || '', unit: p.unit, summary: p.summary,
      label: data.label || '', n: data.n === undefined ? null : data.n, l: data.l === undefined ? null : data.l,
      a: data.a === undefined ? null : data.a, h: data.h === undefined ? null : data.h, pos: maxPos + 1, ts: Date.now(), voice: !!fromVoice };
    S.lines.push(line); S.lastAdded = line;
    DB.put('lineas', line);
    renderMedir(line.id);
    return line;
  }
  function updateLine(line) { DB.put('lineas', line); }
  function deleteLine(id) {
    S.lines = S.lines.filter(function (l) { return l.id !== id; });
    DB.del('lineas', id);
    renderMedir();
  }

  function renderMedir(flashId) {
    var has = !!S.current && S.catalog;
    $('noPartida').classList.toggle('hidden', !!has);
    $('partidaCard').classList.toggle('hidden', !has);
    $('linesWrap').classList.toggle('hidden', !has);
    if (!has) return;
    var p = S.catalog.partidas[S.current.code];
    $('pCrumbs').textContent = chapterPath(S.current.chapter).join(' › ');
    $('pCode').textContent = p.code; $('pUnit').textContent = p.unit; $('pSummary').textContent = p.summary;
    $('pText').textContent = p.text || '(sin descripción)';
    var lines = currentLines();
    var total = lines.reduce(function (a, l) { return a + VP.subtotal(l); }, 0);
    $('pTotal').textContent = Ex.fmt(total); $('pTotalUnit').textContent = p.unit;
    var tb = $('linesBody'); tb.innerHTML = '';
    lines.forEach(function (l) {
      var sub = VP.subtotal(l);
      var subCell = el('span', { class: 'sub', text: Ex.fmt(sub) });
      var tr = el('div', { class: 'lrow' + (sub < 0 ? ' neg' : '') + (l.id === flashId ? ' flash' : '') });
      var lab = inp(l, 'label', 'text'); lab.classList.add('c-label'); lab.placeholder = 'Comentario';
      tr.appendChild(lab);
      var ph = { n: 'Uds', l: 'Largo', a: 'Ancho', h: 'Alto' };
      ['n', 'l', 'a', 'h'].forEach(function (f) { var i = inp(l, f, 'num'); i.placeholder = ph[f]; tr.appendChild(i); });
      tr.appendChild(subCell);
      tr.appendChild(el('button', { class: 'del', title: 'Eliminar línea', 'aria-label': 'Eliminar línea', text: '×', onclick: function () { deleteLine(l.id); } }));
      tb.appendChild(tr);
      function inp(line, field, kind) {
        var i = el('input', { type: 'text', inputmode: kind === 'num' ? 'decimal' : 'text', 'aria-label': field });
        i.value = kind === 'num' ? numInput(line[field]) : (line[field] || '');
        i.addEventListener('change', function () {
          line[field] = kind === 'num' ? parseNum(i.value) : i.value;
          if (kind === 'num') i.value = numInput(line[field]);
          updateLine(line);
          var s = VP.subtotal(line); subCell.textContent = Ex.fmt(s); tr.classList.toggle('neg', s < 0);
          var t = currentLines().reduce(function (a, x) { return a + VP.subtotal(x); }, 0);
          $('pTotal').textContent = Ex.fmt(t);
        });
        return i;
      }
    });
  }

  // ------------------------------------------------------------ resumen
  function renderSummary() {
    var box = $('summary'); box.innerHTML = '';
    if (!S.lines.length || !S.catalog) { box.appendChild(el('p', { class: 'hint', text: 'Aún no hay mediciones en esta visita.' })); return; }
    var rep = Ex.buildReport(S.lines, S.catalog);
    (function walk(node, depth) {
      node.children.forEach(function (c) {
        if (c.kind === 'chapter') { box.appendChild(el('div', { class: 's-chap' + (depth ? ' sub' : ''), text: c.num + '  ' + c.summary })); walk(c, depth + 1); }
        else box.appendChild(el('div', { class: 's-part', onclick: function () { selectPartida(c.code, c.lines[0].chapter); showView('medir'); } }, [
          el('span', { text: c.num + '  ' + c.summary + ' (' + c.lines.length + ' lín.)' }), el('b', { text: Ex.fmt(c.total) + ' ' + c.unit })]));
      });
    })(rep, 0);
  }

  function renderAll() {
    renderVisitaHeader();
    renderMedir();
    if ($('view-catalogo').classList.contains('active')) renderCatalog();
    if ($('view-visita').classList.contains('active')) renderSummary();
  }

  // ------------------------------------------------------------ voz
  function logVoice(heard, result, ok) {
    var ul = $('voiceLog');
    ul.insertBefore(el('li', {}, [el('div', { class: 'heard', text: '«' + heard + '»' }), el('div', { class: ok ? 'ok' : 'bad', text: result })]), ul.firstChild);
    while (ul.children.length > 30) ul.removeChild(ul.lastChild);
  }
  function describeLine(l) {
    var parts = [];
    if (l.label) parts.push(l.label);
    if (l.n !== null && l.n !== undefined) parts.push(VP.speakNum(l.n) + (Math.abs(l.n) === 1 ? ' unidad' : ' unidades'));
    var dims = ['l', 'a', 'h'].filter(function (f) { return l[f] !== null && l[f] !== undefined; }).map(function (f) { return VP.speakNum(l[f]); });
    if (dims.length) parts.push(dims.join(' por '));
    return parts.join(', ') + ', igual a ' + VP.speakNum(VP.subtotal(l));
  }
  function lineSummaryText(l) {
    var f = function (k, lab) { return l[k] !== null && l[k] !== undefined ? lab + ' ' + Ex.fmt(l[k]) : null; };
    return [l.label ? '«' + l.label + '»' : null, f('n', 'Uds'), f('l', 'L'), f('a', 'A'), f('h', 'H')].filter(Boolean).join(' · ') + ' = ' + Ex.fmt(VP.subtotal(l));
  }
  function say(text) { return Sp.Speaker.say(text, S.engine); }

  function handleUtterance(text, source) {
    text = (text || '').trim();
    if (!text) return;
    if (!S.catalog) { logVoice(text, 'Carga primero una base de precios BC3', false); return; }
    var p = S.current && S.catalog.partidas[S.current.code];
    var r = VP.parseUtterance(text, { unit: p ? p.unit : '' });
    if (r.cmd) return runCommand(r, text);
    if (!p) { logVoice(text, 'Sin partida activa. Di «buscar …»', false); say('Primero elige una partida. Di buscar y el nombre.'); return; }
    if (!r.ok) { logVoice(text, 'No he entendido ninguna medida', false); say('No he entendido. Repite.'); return; }
    var line = addLine(r, source === 'voice');
    if (!line) return;
    logVoice(text, '✓ ' + lineSummaryText(line), true);
    var total = currentLines().reduce(function (a, l) { return a + VP.subtotal(l); }, 0);
    say(describeLine(line) + '. Total ' + VP.speakNum(total));
  }

  function runCommand(r, text) {
    switch (r.cmd) {
      case 'undo': {
        var ls = currentLines(); var last = ls[ls.length - 1];
        if (!last) { logVoice(text, 'No hay líneas que borrar', false); say('No hay líneas.'); return; }
        deleteLine(last.id); logVoice(text, 'Borrada: ' + lineSummaryText(last), true); say('Borrada la última línea'); return;
      }
      case 'repeat': {
        var l2 = currentLines(); var lst = l2[l2.length - 1];
        if (!lst) { say('No hay líneas.'); return; }
        logVoice(text, 'Última: ' + lineSummaryText(lst), true); say(describeLine(lst)); return;
      }
      case 'total': {
        if (!S.current) { say('No hay partida activa.'); return; }
        var p = S.catalog.partidas[S.current.code];
        var t = currentLines().reduce(function (a, l) { return a + VP.subtotal(l); }, 0);
        logVoice(text, 'Total: ' + Ex.fmt(t) + ' ' + p.unit, true);
        say('Total ' + VP.speakNum(t) + ' ' + spokenUnit(p.unit) + ' en ' + currentLines().length + ' líneas'); return;
      }
      case 'search': {
        var res = search(r.query, 6);
        S.choices = res;
        renderChoices(r.query);
        if (!res.length) { logVoice(text, 'Sin resultados', false); say('No encuentro ' + r.query); return; }
        if (res.length === 1) { selectPartida(res[0].code); logVoice(text, 'Seleccionada ' + res[0].code, true); say('Partida ' + res[0].summary); return; }
        logVoice(text, res.length + ' resultados: di «opción N»', true);
        say(res.slice(0, 3).map(function (p, i) { return 'Opción ' + (i + 1) + ': ' + p.summary; }).join('. ')); return;
      }
      case 'choose': {
        var c = S.choices[r.index - 1];
        if (!c) { say('No hay opción ' + r.index); logVoice(text, 'Opción no válida', false); return; }
        selectPartida(c.code); logVoice(text, 'Seleccionada ' + c.code + ' ' + c.summary, true); say('Partida ' + c.summary); return;
      }
      case 'stop': logVoice(text, 'Micro en pausa', true); stopListening(); return;
      case 'blank': addLine({}, true); logVoice(text, 'Línea en blanco añadida', true); return;
      case 'comment': {
        var ln = addLine({ label: r.text }, true);
        if (ln) { logVoice(text, 'Comentario: ' + r.text, true); say('Comentario añadido'); }
        return;
      }
    }
  }
  function spokenUnit(u) {
    var k = norm(u);
    return ({ 'm²': 'metros cuadrados', m2: 'metros cuadrados', 'm³': 'metros cúbicos', m3: 'metros cúbicos', m: 'metros', ml: 'metros lineales', u: 'unidades', ud: 'unidades', kg: 'kilos', t: 'toneladas' })[k] || u;
  }
  function renderChoices(q) {
    var box = $('searchOverlay'), ol = $('searchOverlayList');
    ol.innerHTML = '';
    $('searchOverlayTitle').textContent = 'Resultados para «' + q + '» — di «opción N»';
    S.choices.forEach(function (p) { ol.appendChild(partidaItem(p, function (pp) { selectPartida(pp.code); })); });
    box.classList.toggle('hidden', !S.choices.length);
    showView('medir');
  }

  function setVoiceState(state, detail) {
    var labels = { idle: 'Micro apagado', listening: 'Escuchando…', hearing: 'Oyendo…', processing: 'Transcribiendo…', loading: 'Cargando modelo…', error: 'Error' };
    var txt = labels[state] || state;
    if (state === 'loading' && typeof detail === 'number') { txt = 'Modelo ' + Math.round(detail * 100) + '%'; $('whisperProgress').classList.remove('hidden'); $('whisperProgress').value = detail; }
    if (state === 'listening' || state === 'idle') $('whisperProgress').classList.add('hidden');
    $('voiceStatus').dataset.state = state; $('voiceStatusText').textContent = txt;
    $('micBtn').dataset.state = state === 'error' ? (S.listening ? 'listening' : 'idle') : state;
    if (state === 'error' && detail) { toast(detail, 6000); logVoice('—', detail, false); }
    if (state === 'idle') { S.listening = false; $('micBtn').dataset.state = 'idle'; releaseWake(); }
  }

  function makeEngine() {
    var e = S.settings.engine;
    var eng = e === 'webspeech' ? new Sp.WebSpeechEngine({ lang: 'es-ES' })
      : new Sp.WhisperEngine({ model: e === 'whisper-tiny' ? 'onnx-community/whisper-tiny' : 'onnx-community/whisper-base' });
    eng.onState = setVoiceState;
    eng.onText = function (text, isFinal) {
      if (!isFinal) { $('interim').textContent = text; return; }
      $('interim').textContent = '';
      handleUtterance(text, 'voice');
    };
    return eng;
  }
  function startListening() {
    if (S.engine) S.engine.stop();
    S.engine = makeEngine();
    S.listening = true;
    $('micBtn').dataset.state = 'listening';
    S.engine.start();
    acquireWake();
  }
  function stopListening() {
    S.listening = false;
    if (S.engine) S.engine.stop();
    $('interim').textContent = '';
    releaseWake();
  }
  function acquireWake() {
    if (!S.settings.wake || !navigator.wakeLock) return;
    navigator.wakeLock.request('screen').then(function (w) { S.wakeLock = w; }).catch(function () {});
  }
  function releaseWake() { if (S.wakeLock) { S.wakeLock.release().catch(function () {}); S.wakeLock = null; } }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.listening) acquireWake(); });

  function engineHint() {
    var e = S.settings.engine, h = '';
    if (e === 'webspeech') h = Sp.WebSpeechEngine.isSupported() ? 'En Chrome/Edge el audio se procesa en los servidores del navegador: sin cobertura no funcionará. Safari (iOS) puede reconocer en el dispositivo.' : 'Este navegador no tiene Web Speech API. Elige Whisper.';
    else h = 'Whisper se ejecuta en tu dispositivo. Descarga el modelo una vez con conexión y queda guardado en la caché del navegador. Usa WebGPU si está disponible.';
    $('engineHint').textContent = h;
  }

  // ------------------------------------------------------------ exportación / copia
  function exportJson() {
    var data = { app: 'medicion-voz', version: 1, visita: S.visita, lineas: S.lines, catalogo: S.catalog ? S.catalog.meta : null };
    Ex.download(JSON.stringify(data, null, 1), (S.visita.nombre || 'visita').replace(/[^\w-]+/g, '_') + '.json', 'application/json');
  }
  function importJson(file) {
    file.text().then(function (t) {
      var d = JSON.parse(t);
      if (!d.visita || !Array.isArray(d.lineas)) throw new Error('Formato no válido');
      var v = d.visita; var exists = S.visitas.some(function (x) { return x.id === v.id; });
      if (exists) { v = Object.assign({}, v, { id: uid(), nombre: v.nombre + ' (importada)' }); }
      v.created = Date.now();
      var lines = d.lineas.map(function (l) { return Object.assign({}, l, { id: uid(), visitaId: v.id }); });
      return DB.put('visitas', v).then(function () { return DB.putMany('lineas', lines); }).then(function () {
        S.visitas.push(v); toast('Visita importada: ' + lines.length + ' líneas'); return switchVisita(v.id);
      });
    }).catch(function (e) { toast('No se pudo importar: ' + e.message, 5000); });
  }

  // ------------------------------------------------------------ eventos
  function bind() {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showView(b.dataset.view); }); });
    $('micBtn').addEventListener('click', function () {
      if (S.listening) stopListening(); else startListening();
    });
    var st;
    $('searchInput').addEventListener('input', function () { clearTimeout(st); st = setTimeout(renderCatalog, 120); });
    $('bc3File').addEventListener('change', function (e) { if (e.target.files[0]) loadBC3File(e.target.files[0]); e.target.value = ''; });
    $('manualSend').addEventListener('click', function () { handleUtterance($('manualInput').value, 'manual'); $('manualInput').value = ''; });
    $('manualInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') { handleUtterance($('manualInput').value, 'manual'); $('manualInput').value = ''; } });
    $('addLine').addEventListener('click', function () {
      addLine({});
      var inputs = $('linesBody').lastElementChild ? $('linesBody').lastElementChild.querySelectorAll('input') : []; if (inputs[0]) inputs[0].focus();
    });
    $('closeOverlay').addEventListener('click', function () { $('searchOverlay').classList.add('hidden'); S.choices = []; });
    ['vNombre', 'vDireccion', 'vTecnico', 'vFecha', 'vNotas'].forEach(function (id) { $(id).addEventListener('change', saveVisita); });
    $('visitaSelect').addEventListener('change', function (e) { switchVisita(e.target.value); });
    $('newVisita').addEventListener('click', function () {
      newVisita().then(function () {
        DB.kvGet('lastTecnico').then(function (t) { if (t) { S.visita.tecnico = t; DB.put('visitas', S.visita); renderVisitaHeader(); } });
        toast('Nueva visita creada'); $('vNombre').focus(); $('vNombre').select();
      });
    });
    $('delVisita').addEventListener('click', function () {
      if (!confirm('¿Eliminar la visita «' + S.visita.nombre + '» y sus ' + S.lines.length + ' líneas? No se puede deshacer.')) return;
      var id = S.visita.id;
      DB.deleteVisita(id).then(function () {
        S.visitas = S.visitas.filter(function (v) { return v.id !== id; });
        return S.visitas.length ? switchVisita(S.visitas[S.visitas.length - 1].id) : newVisita();
      });
    });
    $('exportPdf').addEventListener('click', function () {
      if (!S.lines.length) return toast('No hay mediciones que exportar');
      try { Ex.exportPDF(S.visita, Ex.buildReport(S.lines, S.catalog), { longText: $('optLongText').checked, catalogTitle: S.catalog.meta.title }); }
      catch (e) { toast('Error al generar el PDF: ' + e.message, 5000); console.error(e); }
    });
    $('exportBc3').addEventListener('click', function () {
      if (!S.lines.length) return toast('No hay mediciones que exportar');
      Ex.exportBC3(S.visita, Ex.buildReport(S.lines, S.catalog), S.catalog.meta);
    });
    $('exportJson').addEventListener('click', exportJson);
    $('importJson').addEventListener('change', function (e) { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ''; });
    $('optLongText').addEventListener('change', function (e) { S.settings.longText = e.target.checked; saveSettings(); });
    $('setEngine').addEventListener('change', function (e) {
      S.settings.engine = e.target.value; saveSettings(); engineHint();
      if (S.listening) startListening();
    });
    $('setTts').addEventListener('change', function (e) { S.settings.tts = e.target.checked; Sp.Speaker.enabled = e.target.checked; saveSettings(); });
    $('setWake').addEventListener('change', function (e) { S.settings.wake = e.target.checked; saveSettings(); });
    $('preloadWhisper').addEventListener('click', function () {
      var model = S.settings.engine === 'whisper-tiny' ? 'onnx-community/whisper-tiny' : 'onnx-community/whisper-base';
      var pr = $('whisperProgress'); pr.classList.remove('hidden'); pr.value = 0;
      Sp.WhisperEngine.load(model, function (f) { pr.value = f; })
        .then(function () { pr.classList.add('hidden'); toast('Modelo ' + model.split('/')[1] + ' listo para usar sin conexión'); })
        .catch(function (e) { pr.classList.add('hidden'); toast('No se pudo descargar el modelo: ' + e.message, 6000); });
    });
  }
  function saveSettings() { DB.kvSet('settings', S.settings); }

  // ------------------------------------------------------------ arranque
  function init() {
    bind();
    Promise.all([DB.kvGet('settings'), DB.kvGet('catalogMeta'), DB.getAll('partidas'), DB.getAll('chapters'), DB.getAll('visitas'), DB.kvGet('currentVisita')])
      .then(function (r) {
        if (r[0]) Object.assign(S.settings, r[0]);
        $('setEngine').value = S.settings.engine; $('setTts').checked = S.settings.tts; $('setWake').checked = S.settings.wake; $('optLongText').checked = S.settings.longText;
        Sp.Speaker.enabled = S.settings.tts;
        engineHint();
        if (r[1] && r[2].length) setCatalog(r[1], r[2], r[3]);
        S.visitas = r[4] || [];
        if (!S.visitas.length) return newVisita();
        var cur = S.visitas.some(function (v) { return v.id === r[5]; }) ? r[5] : S.visitas[0].id;
        return switchVisita(cur);
      })
      .then(function () {
        if (!S.catalog) { showView('ajustes'); toast('Carga una base de precios .bc3 para empezar', 4000); }
        if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) {
          $('storageInfo').textContent = 'Espacio usado: ' + (e.usage / 1048576).toFixed(1) + ' MB de ' + (e.quota / 1048576 / 1024).toFixed(1) + ' GB disponibles.';
        });
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      })
      .catch(function (e) { console.error(e); toast('Error al iniciar: ' + e.message, 6000); });

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  window.App = { S: S, handleUtterance: handleUtterance, search: search };
  init();
})();

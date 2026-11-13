/* ============================================================
 * APP — UI "Modo Obra", adaptadores (Storage / Voice / Billing),
 * gestión de obras y catálogos, exportación PDF.
 * ============================================================ */
(function () {
  'use strict';
  const E = window.Engine;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
    obras: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h11a3 3 0 013 3v13H7a3 3 0 01-3-3V4z"/><path d="M4 17a3 3 0 013-3h11"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 14h6M9 18h6"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.5M12 17h.01"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>'
  };

  /* ============================================================
   * StorageAdapter — IndexedDB nativo con respaldo en memoria.
   * (En Capacitor se puede sustituir por @capacitor/preferences o SQLite
   *  implementando la misma interfaz get/put/del/all.)
   * ============================================================ */
  const StorageAdapter = (() => {
    const mem = { obras: new Map(), catalogos: new Map(), ajustes: new Map() };
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((res) => {
        try {
          const rq = indexedDB.open('mediciones-voz', 1);
          rq.onupgradeneeded = () => { const db = rq.result; ['obras', 'catalogos'].forEach((s) => db.createObjectStore(s, { keyPath: 'id' })); db.createObjectStore('ajustes'); };
          rq.onsuccess = () => res(rq.result);
          rq.onerror = () => res(null);
          rq.onblocked = () => res(null);
        } catch (e) { res(null); }
      });
      return dbp;
    }
    async function tx(store, mode, fn) {
      const db = await open();
      if (!db) return fn(null);
      return new Promise((res) => {
        try {
          const t = db.transaction(store, mode); const s = t.objectStore(store);
          const rq = fn(s);
          t.oncomplete = () => res(rq && 'result' in rq ? rq.result : undefined);
          t.onerror = () => res(undefined);
        } catch (e) { res(undefined); }
      });
    }
    return {
      async get(store, key) { const r = await tx(store, 'readonly', (s) => s ? s.get(key) : null); return r !== undefined && r !== null ? r : (mem[store].get(key) ?? null); },
      async put(store, val, key) { mem[store].set(key ?? val.id, val); await tx(store, 'readwrite', (s) => s ? (key !== undefined ? s.put(val, key) : s.put(val)) : null); },
      async del(store, key) { mem[store].delete(key); await tx(store, 'readwrite', (s) => s ? s.delete(key) : null); },
      async all(store) { const r = await tx(store, 'readonly', (s) => s ? s.getAll() : null); return Array.isArray(r) ? r : [...mem[store].values()]; }
    };
  })();

  /* ============================================================
   * BillingGuard — reglas de plan (Demo / Pago por obra / Pro).
   * En nativo: conectar con In-App Purchase (RevenueCat / cordova-plugin-purchase)
   * o Stripe Checkout en web. Aquí la compra está simulada.
   * ============================================================ */
  const BillingGuard = {
    plan: 'demo',
    MAX_DEMO: 2,
    canCreateObra(n) { return this.plan === 'pro' || n < this.MAX_DEMO; },
    canImportBC3() { return true; },
    watermark(obra) { return this.plan !== 'pro' && !(obra && obra.unlocked); },
    async unlockObra(obra) { obra.unlocked = true; return true; /* simulado */ },
    async subscribe() { this.plan = 'pro'; return true; /* simulado */ }
  };

  /* ============================================================
   * VoiceAdapter — reconocimiento y síntesis de voz.
   *  1) Navegador (Chrome / Edge / Safari): SpeechRecognition + speechSynthesis.
   *  2) Dentro de claude.ai: capacidad "dictation" (+ síntesis nativa).
   *  En Capacitor: @capacitor-community/speech-recognition y
   *  @capacitor-community/text-to-speech con la misma interfaz.
   *
   *  Conversación: mientras la app habla, el micrófono se cierra (para no
   *  escucharse a sí misma); al terminar de hablar vuelve a abrirse solo.
   *  Si el navegador exige un toque para reabrirlo (iPhone), se avisa.
   * ============================================================ */
  const VoiceAdapter = (() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const synth = window.speechSynthesis || null;
    const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
    let mode = 'none', dict = null, tts = null, rec = null, listening = false, speaking = false, unlocked = false;
    let cb = { onPartial() {}, onFinal() {}, onState() {}, onError() {}, onEnd() {}, onReady() {} };
    let voice = null, rate = 1.05, gotFinal = false, buf = '', bufTimer = null, lastPartial = '';
    let micState = 'unknown'; // unknown | granted | denied | unavailable
    let needTap = false, autoRestarts = 0;
    function pickVoice(uri) {
      if (!synth) return;
      const vs = synth.getVoices().filter((v) => /^es/i.test(v.lang));
      voice = vs.find((v) => v.voiceURI === uri) || vs.find((v) => /es-ES/i.test(v.lang) && /google|monica|mónica|lucia|lucía|elena|helena|laura|paulina|jorge/i.test(v.name)) || vs.find((v) => /es-ES/i.test(v.lang)) || vs[0] || null;
    }
    if (synth) { pickVoice(); try { synth.addEventListener('voiceschanged', () => pickVoice(voice && voice.voiceURI)); } catch (e) {} }
    const state = () => cb.onState({ listening, speaking, needTap, micState });
    const timeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
    async function init() {
      if (window.claude && typeof window.claude.use === 'function') {
        try {
          dict = await timeout(window.claude.use('dictation'), 6000);
          if (!synth) tts = await timeout(window.claude.use('tts'), 4000);
        } catch (e) { dict = null; }
      }
      if (dict) {
        mode = 'claude';
        dict.onPartial(({ text }) => { if (!speaking) cb.onPartial((buf + text).trim()); });
        dict.onFinal(({ text }) => {
          if (speaking) return; // no escucharnos a nosotros mismos
          buf = (buf + text).replace(/^\s+/, '');
          cb.onPartial(buf);
          clearTimeout(bufTimer);
          bufTimer = setTimeout(() => { const t = buf.trim(); buf = ''; if (t) cb.onFinal(t); }, 1100);
        });
        dict.onState(({ state: s, reason }) => {
          listening = s === 'listening' || s === 'starting';
          if (s === 'listening') micState = 'granted';
          if (s === 'idle' && reason === 'unavailable') { micState = 'unavailable'; cb.onError('unavailable'); }
          state();
        });
      } else if (SR && !(inFrame && window.claude)) mode = 'native';
      else if (SR) mode = 'native'; // marco sin dictado: lo intentamos; si se bloquea, lo decimos
      cb.onReady(mode);
      return mode;
    }
    /** Debe llamarse dentro de un toque: desbloquea el audio en iPhone/Android. */
    function unlock() {
      if (unlocked || !synth) return;
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'es-ES'; synth.speak(u); unlocked = true; } catch (e) {}
    }
    function splitSentences(t) { return (t.match(/[^.?!;]+[.?!;]*/g) || [t]).map((s) => s.trim()).filter(Boolean); }
    let speakId = 0;
    function speak(text) {
      return new Promise((resolve) => {
        if (!text) return resolve();
        const my = ++speakId;
        // Cerrar el micro mientras hablamos
        if (mode === 'native' && listening) { try { rec && rec.abort(); } catch (e) {} listening = false; }
        if (!synth && tts) {
          speaking = true; state();
          tts.speak(text.slice(0, 1990), { language: 'es' }).catch(() => {}).finally(() => { if (my === speakId) { speaking = false; state(); } resolve(); });
          return;
        }
        if (!synth) return resolve();
        try { synth.cancel(); } catch (e) {}
        const parts = splitSentences(text);
        speaking = true; state();
        let i = 0, done = false;
        const finish = () => { if (done) return; done = true; if (my === speakId) { speaking = false; state(); } resolve(); };
        const guard = setTimeout(finish, 4000 + text.length * 95);
        const next = () => {
          if (done) return;
          if (i >= parts.length) { clearTimeout(guard); return setTimeout(finish, 250); }
          const u = new SpeechSynthesisUtterance(parts[i++]);
          u.lang = 'es-ES'; if (voice) u.voice = voice; u.rate = rate;
          u.onend = next; u.onerror = () => { clearTimeout(guard); finish(); };
          synth.speak(u);
          // Chrome Android a veces deja la síntesis en pausa
          try { if (synth.paused) synth.resume(); } catch (e) {}
        };
        next();
      });
    }
    function stopSpeaking() { speakId++; if (synth) try { synth.cancel(); } catch (e) {} if (tts) try { tts.stop(); } catch (e) {} speaking = false; state(); }
    /** fromTap: true si viene de un toque del usuario. */
    function listen(fromTap) {
      if (fromTap) { needTap = false; autoRestarts = 0; unlock(); }
      if (mode === 'claude') {
        if (!fromTap && !listening) { needTap = true; state(); return; } // el dictado exige gesto; si ya escucha, sigue escuchando
        dict.start({ language: 'es' }).catch((e) => {
          const code = e && e.code;
          if (code === 'unavailable') return dict.start().catch((e2) => { listening = false; state(); cb.onError(e2 && e2.code); });
          listening = false; state(); cb.onError(code);
        });
        return;
      }
      if (mode !== 'native') return;
      if (listening) return;
      try {
        rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
        gotFinal = false; lastPartial = '';
        rec.onstart = () => { micState = 'granted'; listening = true; needTap = false; state(); };
        rec.onresult = (e) => {
          if (speaking) return;
          let fin = '', inter = '';
          for (let k = e.resultIndex; k < e.results.length; k++) { const r = e.results[k]; if (r.isFinal) fin += r[0].transcript; else inter += r[0].transcript; }
          if (inter) { lastPartial = inter; cb.onPartial(inter); }
          if (fin && !gotFinal) { gotFinal = true; lastPartial = ''; cb.onPartial(''); cb.onFinal(fin.trim()); }
        };
        rec.onerror = (e) => {
          const code = e.error;
          if (code === 'not-allowed' || code === 'service-not-allowed') {
            if (micState === 'granted' && !fromTap) { needTap = true; state(); return; } // iPhone: pide un toque para reabrir
            micState = 'denied';
          }
          if (code === 'aborted') return;
          cb.onError(code);
        };
        rec.onend = () => {
          listening = false; state();
          if (!gotFinal && lastPartial) { const t = lastPartial; lastPartial = ''; cb.onPartial(''); gotFinal = true; cb.onFinal(t); return; }
          cb.onEnd(gotFinal);
        };
        rec.start(); listening = true; state();
      } catch (e) {
        listening = false;
        if (!fromTap) needTap = true;
        state();
      }
    }
    function stopListening() { needTap = false; if (mode === 'claude') { dict && dict.stop().catch(() => {}); return; } try { rec && rec.abort(); } catch (e) {} listening = false; state(); }
    return {
      init, speak, stopSpeaking, listen, stopListening, unlock,
      on(c) { cb = Object.assign(cb, c); },
      get mode() { return mode; }, get listening() { return listening; }, get speaking() { return speaking; },
      get needTap() { return needTap; }, set needTap(v) { needTap = v; state(); },
      get micState() { return micState; }, get inFrame() { return inFrame; },
      setRate(r) { rate = r; }, setVoice(uri) { pickVoice(uri); },
      voices() { return synth ? synth.getVoices().filter((v) => /^es/i.test(v.lang)) : []; },
      get voiceURI() { return voice && voice.voiceURI; },
      canSpeak: !!(synth)
    };
  })();

  /* ============================================================
   * Estado de la app
   * ============================================================ */
  const S = {
    view: 'obras', obra: null, obras: [], cats: [], catsPrepared: new Map(), activeCat: 'palma48',
    settings: { mode: 'obra', hands: true, plan: 'demo', rate: 1.05, voice: null, catalogo: 'palma48' },
    log: [], chips: [], chipsLong: false, partial: '', filterEst: null, lastLineId: null, typing: false
  };
  const dialog = new E.Dialog({
    say: (text, chips, opts) => say(text, chips, opts),
    user: (text) => { S.log.push({ who: 'user', text }); S.partial = ''; renderTalk(); },
    save: () => saveObra(),
    render: () => render(),
    getCatalog: () => catFor(S.obra),
    exportPdf: () => exportPdf(S.obra),
    flash: (k) => { const p = dialog.active(); if (p && p.lineas.length) S.lastLineId = p.lineas[p.lineas.length - 1].id; render(); const t = $('.total'); if (t) { t.classList.add('flash-' + k); setTimeout(() => t.classList.remove('flash-' + k), 900); } },
    filterEst: (e) => { S.filterEst = e; }
  });

  function catFor(obra) {
    const id = (obra && obra.catalogo) || S.settings.catalogo;
    return S.catsPrepared.get(id) || S.catsPrepared.get('palma48');
  }
  async function loadCatalog(id) {
    if (S.catsPrepared.has(id)) return S.catsPrepared.get(id);
    let c = await StorageAdapter.get('catalogos', id);
    if (!c && id === 'palma48') c = baseCatalog();
    if (!c) return null;
    const p = E.prepareCatalog(c.data);
    p.id = id; p.nombre = c.nombre;
    S.catsPrepared.set(id, p);
    return p;
  }
  function baseCatalog() { return { id: 'palma48', nombre: 'Precios de Mallorca 2026 (COAAT)', base: true, n: window.CATALOGO_BASE.partidas.length, data: window.CATALOGO_BASE, fecha: Date.now() }; }

  async function saveObra() { if (!S.obra) return; S.obra.updated = Date.now(); await StorageAdapter.put('obras', JSON.parse(JSON.stringify(S.obra))); }
  async function saveSettings() { BillingGuard.plan = S.settings.plan; await StorageAdapter.put('ajustes', S.settings, 'settings'); }

  /* ============================================================
   * Diálogo: salida de voz y bocadillos
   * ============================================================ */
  let sayToken = 0;
  async function say(text, chips, opts) {
    opts = opts || {};
    const last = S.log[S.log.length - 1];
    if (!(last && last.who === 'app' && last.text === text && opts.repeat)) S.log.push({ who: 'app', text });
    if (S.log.length > 40) S.log.splice(0, S.log.length - 40);
    S.chips = chips || []; S.chipsLong = !!opts.long || S.chips.some((c) => (c.label || '').length > 34);
    renderTalk(); renderChips();
    if (!S.session) return; // hasta el primer toque el navegador no deja hablar ni escuchar
    const tk = ++sayToken;
    await VoiceAdapter.speak(text);
    if (tk !== sayToken) return;
    if (S.view === 'obra' && S.settings.hands && opts.listen !== false && !S.typing) { noSpeech = 0; VoiceAdapter.listen(false); }
  }
  /** Primer toque: desbloquea audio, pide permiso de micrófono y empieza la conversación guiada. */
  function startSession() {
    VoiceAdapter.unlock();
    S.session = true; S.greetPending = true;
    hideWarn();
    if (VoiceAdapter.mode === 'native' || VoiceAdapter.mode === 'claude') VoiceAdapter.listen(true); // pide permiso dentro del toque
    else greet();
    // si el permiso tarda o no llega, saludamos igualmente
    setTimeout(() => { if (S.greetPending && !VoiceAdapter.listening) greet(); }, 2500);
    render();
  }
  function greet() {
    if (!S.greetPending) return; S.greetPending = false;
    const lp = dialog.lastPrompt;
    if (lp) say(lp.text, lp.chips, Object.assign({}, lp.opts || {}, { repeat: true }));
  }
  let noSpeech = 0;
  VoiceAdapter.on({
    onPartial(t) { S.partial = t; renderTalk(); },
    onFinal(t) { noSpeech = 0; S.partial = ''; if (S.greetPending) return; if (S.view === 'obra') { sayToken++; VoiceAdapter.stopSpeaking(); dialog.handle(t); } },
    onState(st) {
      renderMic();
      if (S.greetPending && st.listening && VoiceAdapter.micState === 'granted') greet();
    },
    onError(code) {
      if (code === 'no-speech') {
        if (S.settings.hands && ++noSpeech < 3) return setTimeout(() => { if (!VoiceAdapter.speaking && S.view === 'obra') VoiceAdapter.listen(false); }, 250);
        VoiceAdapter.needTap = true; return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'not_granted') {
        S.micBlocked = true; renderMic();
        warnVoice(VoiceAdapter.inFrame
          ? 'El micrófono está bloqueado dentro de esta ventana. Abre la app desde su propia dirección (https) en Chrome o Safari. Mientras, puedes escribir.'
          : 'El navegador ha denegado el micrófono. Actívalo en el candado de la barra de direcciones › Permisos › Micrófono, y vuelve a tocar el micro.');
        greet();
      } else if (code === 'unavailable') { warnVoice('El dictado no está disponible en esta vista. Usa el teclado o abre la app en Chrome.'); greet(); }
      else if (code === 'network') warnVoice('El reconocimiento de voz de este navegador necesita conexión a internet. Sin cobertura, usa el teclado.');
      else if (code === 'audio-capture') warnVoice('No se detecta micrófono en este dispositivo.');
    },
    onEnd(got) { S.partial = ''; renderTalk(); if (!got && S.session && S.settings.hands && !VoiceAdapter.speaking && S.view === 'obra') { if (++noSpeech < 3) VoiceAdapter.listen(false); else VoiceAdapter.needTap = true; } }
  });
  function hideWarn() { const w = $('#voicewarn'); if (w) w.hidden = true; }
  function warnVoice(t) { const w = $('#voicewarn'); w.textContent = t; w.hidden = false; }

  /* ============================================================
   * Render
   * ============================================================ */
  function render() {
    document.documentElement.dataset.mode = S.settings.mode === 'sol' ? 'sol' : '';
    $('#btnSol').setAttribute('aria-pressed', S.settings.mode === 'sol');
    $('#btnBack').hidden = S.view === 'obras';
    $('#dock').hidden = S.view !== 'obra';
    const v = $('#view');
    const t = $('#title');
    if (S.view === 'obras') { t.innerHTML = 'Mediciones por voz<small>Estado de mediciones · BC3</small>'; v.innerHTML = viewObras(); }
    else if (S.view === 'obra') { t.innerHTML = esc(S.obra.titulo) + '<small>' + esc([S.obra.cliente, S.obra.ubicacion].filter(Boolean).join(' · ') || 'Obra') + '</small>'; v.innerHTML = viewObra(); }
    else if (S.view === 'resumen') { t.innerHTML = 'Resumen<small>' + esc(S.obra.titulo) + '</small>'; v.innerHTML = viewResumen(); }
    else if (S.view === 'catalogos') { t.innerHTML = 'Bases de datos BC3<small>Sin precios: código, unidad, resumen y texto</small>'; v.innerHTML = viewCatalogos(); }
    else if (S.view === 'ajustes') { t.innerHTML = 'Ajustes'; v.innerHTML = viewAjustes(); }
    renderMic();
    if (S.view === 'obra') { renderTalk(); renderChips(); const nr = $('tr.new'); if (nr) nr.scrollIntoView({ block: 'nearest' }); }
  }
  function unitL(u) { return E.unitLabel(u); }
  function viewObra() {
    const o = S.obra, p = dialog.active();
    E.obraChapters(o);
    const est = o.estActiva
      ? '<button class="est" data-a="estancia">' + ICON.pin + 'Estancia: ' + esc(o.estActiva) + '</button>'
      : '<button class="est none" data-a="estancia">' + ICON.pin + (o.ambito === 'libre' ? 'Medición libre' : 'Sin estancia') + '</button>';
    const amb = o.ambito ? '<span class="tag">' + esc(E.AMBITOS[o.ambito].label) + '</span>' : '';
    let mon;
    if (!p) {
      const n = o.partidas.filter((x) => x.lineas.length).length;
      mon = '<section class="monitor"><div class="code">SIN PARTIDA ACTIVA</div><p class="empty">Pulsa el micrófono y di el trabajo a medir, por ejemplo <strong>«picado de azulejos»</strong> o <strong>«pintura plástica en techo»</strong>. Después dicta las medidas: <strong>«pared ducha 1,80 por 2,50»</strong>.</p>' +
        (n ? '<p class="empty">La obra lleva ' + n + ' partida' + (n === 1 ? '' : 's') + ' medida' + (n === 1 ? '' : 's') + '. <button class="btn small" data-a="resumen">Ver resumen</button></p>' : '') + '</section>';
    } else {
      const spec = E.dimsSpec(p);
      const used = { l: p.u === 'm' || p.u === 'm2' || p.u === 'm3', a: p.u === 'm3' || (p.u === 'm2'), h: p.u === 'm3' || p.u === 'm2' };
      const rows = p.lineas.map((l, i) => {
        const cell = (k) => (l[k] === null || l[k] === undefined) ? '<td class="blk">' + (used[k] ? '·' : '—') + '</td>' : '<td>' + E.fmt(l[k]) + '</td>';
        const neg = (l.uds || 0) < 0;
        return '<tr class="' + (neg ? 'neg ' : '') + (l.id === S.lastLineId ? 'new' : '') + '"><td>' + (i + 1) + '</td><td class="com">' + (l.est ? '<span class="e">' + esc(l.est) + '</span>' : '') + esc(l.com || '') + '</td>' +
          '<td>' + E.fmtUds(l.uds) + '</td>' + cell('l') + cell('a') + cell('h') + '<td class="p">' + E.fmt(E.parcial(l)) + '</td>' +
          '<td><div class="rowbtns"><button data-a="editl" data-i="' + i + '" aria-label="Editar línea ' + (i + 1) + '">' + ICON.edit + '</button><button data-a="dell" data-i="' + i + '" aria-label="Borrar línea ' + (i + 1) + '">' + ICON.del + '</button></div></td></tr>';
      }).join('');
      mon = '<section class="monitor"><div class="mon-head"><div class="left"><div class="code"><b>' + esc(p.codigo || '') + '</b> · ' + esc(p.ref) + ' · ' + esc(p.chapTitle) + '</div><div class="resumen">' + esc(p.r) + '</div></div>' +
        '<div class="total"><div class="lbl">Total</div><span class="big num">' + E.fmt(E.totalOf(p)) + '</span><span class="u">' + unitL(p.u) + '</span></div></div>' +
        (p.lineas.length ? '<div class="tablewrap"><table class="lines"><thead><tr><th>#</th><th>Estancia / comentario</th><th>Uds</th><th>Largo</th><th>Ancho</th><th>Alto</th><th>Parcial</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<p class="empty">Sin líneas todavía. ' + esc(spec.ask) + '</p>') +
        '<div class="row"><button class="btn small" data-a="addl">Añadir línea a mano</button><button class="btn small" data-a="close">Cerrar partida</button><button class="btn small" data-a="resumen">Resumen de obra</button></div></section>';
    }
    return '<div class="ctx">' + est + amb + '</div>' + mon;
  }
  function renderTalk() {
    const el = $('#talk'); if (!el) return;
    const last = S.log.slice(-4);
    el.innerHTML = last.map((m, i) => '<div class="bub ' + m.who + (i < last.length - 2 ? ' old' : '') + '">' + esc(m.text) + '</div>').join('') +
      (S.partial ? '<div class="bub user live">' + esc(S.partial) + '…</div>' : '');
    el.scrollTop = el.scrollHeight;
  }
  function renderChips() {
    const el = $('#chips'); if (!el) return;
    el.className = 'chips' + (S.chipsLong ? ' long' : '');
    el.innerHTML = S.chips.map((c, i) => '<button class="chip' + (/^(Ninguna|Ver lista|Medir aparte|Otra distinta|No)\b/.test(c.label) ? ' ghost' : (i === 0 ? ' primary' : '')) + '" data-chip="' + i + '">' + esc(c.label) + '</button>').join('');
  }
  function renderMic() {
    const m = $('#btnMic'); if (!m) return;
    m.classList.toggle('listening', VoiceAdapter.listening && !VoiceAdapter.speaking);
    m.classList.toggle('speaking', VoiceAdapter.speaking);
    m.classList.toggle('tap', !VoiceAdapter.listening && !VoiceAdapter.speaking && VoiceAdapter.needTap);
    m.setAttribute('aria-label', VoiceAdapter.listening ? 'Dejar de escuchar' : VoiceAdapter.speaking ? 'Interrumpir y hablar' : 'Hablar');
    const st = $('#vstate');
    if (st) {
      let t = '';
      if (!S.session) t = '';
      else if (VoiceAdapter.speaking) t = 'Hablando… toca el micro para interrumpir';
      else if (VoiceAdapter.listening) t = 'Te escucho…';
      else if (S.micBlocked) t = 'Micrófono bloqueado · usa el teclado';
      else if (VoiceAdapter.needTap) t = 'Toca el micro para responder';
      else if (VoiceAdapter.mode === 'none') t = 'Sin reconocimiento de voz en este navegador';
      else t = 'Toca el micro para hablar';
      st.textContent = t;
    }
    const sb = $('#startbar'); if (sb) sb.hidden = !!S.session || S.view !== 'obra';
    $('#btnHands').setAttribute('aria-pressed', S.settings.hands);
    $('#btnKeyboard').setAttribute('aria-pressed', S.typing);
    $('#typebar').hidden = !S.typing;
  }

  function viewObras() {
    const list = S.obras.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const canNew = BillingGuard.canCreateObra(list.filter((o) => !o.ejemplo).length);
    const plan = S.settings.plan === 'pro' ? '<span class="badge pro">Plan Pro</span>' : '<span class="badge">Plan Demo · hasta ' + BillingGuard.MAX_DEMO + ' obras · PDF con marca de agua</span>';
    let h = '<div class="row" style="justify-content:space-between">' + plan + '<button class="btn primary" data-a="newobra"' + (canNew ? '' : ' disabled') + '>Nueva obra</button></div>';
    if (!canNew) h += '<p class="hint">Has llegado al límite del plan Demo. Borra una obra o activa el plan Pro en Ajustes.</p>';
    if (!list.length) h += '<div class="card"><h3>Sin obras todavía</h3><p class="hint">Crea una obra, elige el ámbito de la visita y dicta las partidas y medidas mientras recorres la obra.</p></div>';
    list.forEach((o) => {
      const np = o.partidas.filter((p) => p.lineas.length).length, nl = o.partidas.reduce((a, p) => a + p.lineas.length, 0);
      h += '<div class="card"><div class="row" style="justify-content:space-between"><h3>' + esc(o.titulo) + '</h3>' + (o.ejemplo ? '<span class="badge ex">Ejemplo</span>' : o.unlocked ? '<span class="badge pro">Desbloqueada</span>' : '') + '</div>' +
        '<div class="meta">' + esc([o.cliente, o.ubicacion].filter(Boolean).join(' · ')) + (o.cliente || o.ubicacion ? ' · ' : '') + (o.ambito ? esc(E.AMBITOS[o.ambito].label) + ' · ' : '') + np + ' partidas · ' + nl + ' líneas · ' + new Date(o.updated || o.created).toLocaleDateString('es-ES') + '</div>' +
        '<div class="row"><button class="btn primary" data-a="open" data-id="' + o.id + '">Abrir</button><button class="btn" data-a="pdf" data-id="' + o.id + '">PDF</button><button class="btn danger" data-a="delobra" data-id="' + o.id + '">Borrar</button></div></div>';
    });
    h += '<p class="hint">Todo se guarda en este dispositivo. La búsqueda de partidas, el diálogo y el cálculo funcionan sin conexión y sin coste de servicios externos.</p>';
    return h;
  }
  function viewResumen() {
    const o = S.obra;
    const caps = E.obraChapters(o);
    const ests = o.estancias || [];
    let h = '<div class="chips">' + ['Todas'].concat(ests).map((e) => '<button class="chip' + ((S.filterEst || 'Todas') === e ? ' primary' : '') + '" data-a="fest" data-e="' + esc(e) + '">' + esc(e) + '</button>').join('') + '</div>';
    if (!caps.length) return h + '<div class="card"><p class="hint">Todavía no hay partidas en esta obra.</p></div>';
    const fe = S.filterEst && S.filterEst !== 'Todas' ? E.norm(S.filterEst) : null;
    caps.forEach((c) => {
      const ps = c.partidas.filter((p) => !fe || p.lineas.some((l) => E.norm(l.est || '') === fe));
      if (!ps.length) return;
      h += '<div class="chap"><span>' + c.codigo + '</span><span>' + esc(c.titulo) + '</span></div><div class="plist">';
      ps.forEach((p) => {
        const tot = fe ? E.round2(p.lineas.filter((l) => E.norm(l.est || '') === fe).reduce((a, l) => a + E.parcial(l), 0)) : E.totalOf(p);
        h += '<button class="pitem' + (p.uid === o.activa ? ' on' : '') + '" data-a="goto" data-uid="' + p.uid + '"><span class="c">' + p.codigo + '</span><span class="r">' + esc(p.r) + '<small>' + esc(p.ref) + ' · ' + p.lineas.length + ' líneas</small></span><span class="t num">' + E.fmt(tot) + ' ' + unitL(p.u) + '</span></button>';
      });
      h += '</div>';
    });
    h += '<div class="row"><button class="btn primary" data-a="pdf" data-id="' + o.id + '">Exportar PDF</button><button class="btn" data-a="back2obra">Volver a medir</button></div>';
    return h;
  }
  function viewCatalogos() {
    let h = '<p class="hint">Al importar un archivo <code>.bc3</code> se descartan precios, rendimientos e importes. Solo se guardan código, unidad, resumen, texto descriptivo y capítulos.</p>';
    h += '<div class="row"><label class="btn primary" for="bc3file">Importar archivo .bc3</label><input id="bc3file" type="file" accept=".bc3,.BC3" hidden></div>';
    S.cats.forEach((c) => {
      const on = (S.obra && S.obra.catalogo ? S.obra.catalogo : S.settings.catalogo) === c.id;
      h += '<div class="card"><div class="row" style="justify-content:space-between"><h3>' + esc(c.nombre) + '</h3>' + (on ? '<span class="badge pro">En uso</span>' : '') + '</div><div class="meta">' + (c.base ? 'Base incluida · ' : 'Importada · ') + c.n + ' partidas</div>' +
        '<div class="row">' + (on ? '' : '<button class="btn" data-a="usecat" data-id="' + c.id + '">Usar' + (S.obra ? ' en esta obra' : ' por defecto') + '</button>') + (c.base ? '' : '<button class="btn danger" data-a="delcat" data-id="' + c.id + '">Borrar</button>') + '</div></div>';
    });
    h += '<div class="field"><label for="catq">Buscar en la base en uso</label><input id="catq" type="search" placeholder="Ej.: demolición de tabique, toma de corriente…" value="' + esc(S.catQ || '') + '"></div><div class="searchres" id="catres">' + catResults() + '</div>';
    return h;
  }
  function catResults() {
    const q = S.catQ || '';
    if (q.trim().length < 3) return '';
    const cat = catFor(S.obra);
    const r = cat.index.search(q).slice(0, 25);
    if (!r.length) return '<p class="hint">Sin resultados.</p>';
    return r.map((x) => '<div class="pitem"><span class="c">' + esc(x.doc.c) + '</span><span class="r">' + esc(x.doc.r) + '<small>' + esc(x.doc.path) + '</small></span>' + (S.obra ? '<button class="btn small" data-a="addcat" data-code="' + esc(x.doc.c) + '">Añadir</button>' : '<span class="t">' + unitL(x.doc.u) + '</span>') + '</div>').join('');
  }
  function viewAjustes() {
    const vs = VoiceAdapter.voices();
    return '<div class="card"><h3>Plan</h3><div class="meta">Demo: hasta ' + BillingGuard.MAX_DEMO + ' obras y PDF con marca de agua. Pago por obra: desbloquea la exportación limpia de una obra. Pro: obras ilimitadas.</div>' +
      '<div class="row"><button class="btn' + (S.settings.plan === 'demo' ? ' primary' : '') + '" data-a="plan" data-p="demo">Demo</button><button class="btn' + (S.settings.plan === 'pro' ? ' primary' : '') + '" data-a="plan" data-p="pro">Pro (simulado)</button></div>' +
      (S.obra ? '<div class="row"><button class="btn" data-a="unlock"' + (S.obra.unlocked ? ' disabled' : '') + '>' + (S.obra.unlocked ? 'Obra actual desbloqueada' : 'Desbloquear obra actual (simulado)') + '</button></div>' : '') + '</div>' +
      '<div class="card"><h3>Voz</h3><div class="meta">Reconocimiento: ' + ({ native: 'del navegador (es-ES)', claude: 'dictado de Claude', none: 'no disponible, usa el teclado' }[VoiceAdapter.mode]) + '.</div>' +
      (vs.length ? '<div class="field"><label for="selvoice">Voz del asistente</label><select id="selvoice">' + vs.map((v) => '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === VoiceAdapter.voiceURI ? ' selected' : '') + '>' + esc(v.name + ' (' + v.lang + ')') + '</option>').join('') + '</select></div>' : '') +
      '<div class="field"><label for="rate">Velocidad de lectura: ' + S.settings.rate.toFixed(2) + '</label><input id="rate" type="range" min="0.7" max="1.6" step="0.05" value="' + S.settings.rate + '"></div></div>' +
      '<div class="card"><h3>Datos</h3><div class="meta">Las obras y bases importadas se guardan en este navegador (IndexedDB).</div><div class="row"><button class="btn" data-a="backup">Copia de seguridad (.json)</button><label class="btn" for="restorefile">Restaurar copia</label><input id="restorefile" type="file" accept=".json" hidden></div></div>';
  }

  /* ============================================================
   * Acciones
   * ============================================================ */
  async function openObra(id) {
    const o = S.obras.find((x) => x.id === id) || await StorageAdapter.get('obras', id);
    if (!o) return;
    S.obra = o; S.view = 'obra'; S.log = []; S.chips = []; S.filterEst = null;
    await loadCatalog(o.catalogo || S.settings.catalogo);
    dialog.setObra(o);
    render();
  }
  function newObraSheet() {
    sheet('<h2>Nueva obra</h2><form id="fnew" class="card" style="background:none;border:0;padding:0">' +
      '<div class="field"><label for="ftit">Obra</label><input id="ftit" required placeholder="Reforma integral Calle Mayor 14"></div>' +
      '<div class="field"><label for="fcli">Cliente</label><input id="fcli" placeholder="Nombre del cliente"></div>' +
      '<div class="field"><label for="fubi">Ubicación</label><input id="fubi" placeholder="Palma de Mallorca"></div>' +
      '<div class="row"><button class="btn primary" type="submit">Crear y empezar</button><button class="btn" type="button" data-a="closesheet">Cancelar</button></div></form>');
    setTimeout(() => { const i = $('#ftit'); i && i.focus(); }, 50);
    $('#fnew').addEventListener('submit', async (e) => {
      e.preventDefault();
      const o = { id: 'obra_' + Date.now().toString(36), titulo: $('#ftit').value.trim() || 'Obra sin nombre', cliente: $('#fcli').value.trim(), ubicacion: $('#fubi').value.trim(), ambito: null, estActiva: '', estancias: [], partidas: [], activa: null, catalogo: S.settings.catalogo, created: Date.now(), updated: Date.now() };
      S.obras.push(o); await StorageAdapter.put('obras', o);
      closeSheet(); openObra(o.id);
    });
  }
  function sheet(html) { const s = $('#sheet'); s.innerHTML = '<div class="sheet-bg" data-a="closesheet-bg"><div class="sheet" role="dialog" aria-modal="true">' + html + '</div></div>'; s.hidden = false; }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; }
  let toastT = null;
  function toast(msg, undo) {
    const t = $('#toast'); t.innerHTML = esc(msg) + (undo ? '<button data-a="undo">Deshacer</button>' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function menuSheet() {
    const items = [['obras', ICON.obras, 'Mis obras']];
    if (S.obra) items.push(['menu-obra', ICON.pin, 'Medir: ' + S.obra.titulo], ['resumen', ICON.list, 'Resumen de la obra'], ['pdf', ICON.pdf, 'Exportar PDF de mediciones'], ['undo', ICON.undo, 'Deshacer último cambio']);
    items.push(['catalogos', ICON.book, 'Bases de datos BC3'], ['ajustes', ICON.gear, 'Ajustes y plan'], ['ayuda', ICON.help, 'Qué puedo decir']);
    sheet('<h2>Menú</h2><div class="menu-list">' + items.map(([a, i, l]) => '<button data-a="' + a + '"' + (a === 'pdf' ? ' data-id="' + (S.obra ? S.obra.id : '') + '"' : '') + '>' + i + esc(l) + '</button>').join('') + '</div>');
  }
  function helpSheet() {
    sheet('<h2>Qué puedo decir</h2><div class="hint" style="display:flex;flex-direction:column;gap:6px">' +
      ['<b>Trabajo:</b> «picado de azulejos», «pintura plástica en techo», «nueva partida rozas»',
        '<b>Medidas:</b> «pared ducha 1,80 por 2,50», «tres con cuarenta por dos cincuenta», «2 de 1,20 por 1,40», «largo 4 alto 2,6»',
        '<b>Huecos:</b> «descuenta puerta de 0,82 por 2,03»',
        '<b>Estancias:</b> «pasamos al baño», «estancia dormitorio 2», «siguiente estancia»',
        '<b>Revisión:</b> «revisa la última partida», «muéstrame la demolición de alicatado», «lee las líneas», «qué llevo medido en la cocina», «resumen»',
        '<b>Corrección:</b> «borra la última línea», «borra la línea 3», «cambia el largo de la línea 2 a 3 con 40», «cambia la última línea a 3 por 2,5», «deshacer»',
        '<b>Herencia:</b> «aplica las mismas medidas que en el pavimento», «copia las paredes del salón pero descuenta las ventanas»',
        '<b>Partida:</b> «siguiente partida», «borra esta partida», «exporta el PDF»',
        '<b>Diálogo:</b> «repite», «cancela», «ayuda»'].map((x) => '<div>' + x + '</div>').join('') +
      '</div><button class="btn" data-a="closesheet">Cerrar</button>');
  }
  function editLineSheet(i, isNew) {
    const p = dialog.active(); if (!p) return;
    const l = isNew ? { est: S.obra.estActiva || '', com: '', uds: 1, l: null, a: null, h: null } : p.lineas[i];
    const f = (k, lab) => '<div class="field"><label for="el_' + k + '">' + lab + '</label><input id="el_' + k + '" inputmode="decimal" value="' + (l[k] === null || l[k] === undefined ? '' : String(l[k]).replace('.', ',')) + '"></div>';
    sheet('<h2>' + (isNew ? 'Nueva línea' : 'Línea ' + (i + 1)) + '</h2><form id="fline" style="display:flex;flex-direction:column;gap:10px">' +
      '<div class="grid2"><div class="field"><label for="el_est">Estancia</label><input id="el_est" value="' + esc(l.est || '') + '"></div><div class="field"><label for="el_com">Comentario</label><input id="el_com" value="' + esc(l.com || '') + '"></div></div>' +
      '<div class="grid2">' + f('uds', 'Uds') + f('l', 'Largo') + f('a', 'Ancho') + f('h', 'Alto') + '</div>' +
      '<p class="hint">Partida en ' + unitL(p.u) + '. Deja vacías las dimensiones que no apliquen; para deducir un hueco pon unidades negativas.</p>' +
      '<div class="row"><button class="btn primary" type="submit">Guardar</button><button class="btn" type="button" data-a="closesheet">Cancelar</button></div></form>');
    $('#fline').addEventListener('submit', (e) => {
      e.preventDefault();
      const num = (id) => { const v = $('#el_' + id).value.trim(); if (!v) return null; const n = parseFloat(v.replace(',', '.')); return isNaN(n) ? null : n; };
      dialog.snapshot();
      const nl = { est: $('#el_est').value.trim(), com: $('#el_com').value.trim(), uds: num('uds'), l: num('l'), a: num('a'), h: num('h') };
      if (isNew) { nl.id = dialog.nextId(p); p.lineas.push(nl); S.lastLineId = nl.id; } else Object.assign(l, nl);
      p.mod = Date.now(); saveObra(); closeSheet(); render();
    });
  }
  function confirmSheet(msg, okLabel, fn) {
    sheet('<h2>' + esc(msg) + '</h2><div class="row"><button class="btn danger" id="cfok">' + esc(okLabel) + '</button><button class="btn" data-a="closesheet">Cancelar</button></div>');
    $('#cfok').addEventListener('click', () => { closeSheet(); fn(); });
  }

  document.addEventListener('click', async (ev) => {
    const chip = ev.target.closest('[data-chip]');
    if (chip && !S.session) { VoiceAdapter.unlock(); S.session = true; renderMic(); }
    if (chip) { const c = S.chips[+chip.dataset.chip]; VoiceAdapter.stopSpeaking(); if (c) dialog.handle(c); return; }
    const el = ev.target.closest('[data-a]');
    if (!el) return;
    const a = el.dataset.a;
    if (a === 'closesheet-bg') { if (ev.target === el) closeSheet(); return; }
    switch (a) {
      case 'closesheet': closeSheet(); break;
      case 'newobra': newObraSheet(); break;
      case 'open': openObra(el.dataset.id); break;
      case 'obras': closeSheet(); goObras(); break;
      case 'menu-obra': case 'back2obra': closeSheet(); S.view = 'obra'; render(); break;
      case 'resumen': closeSheet(); S.view = 'resumen'; render(); break;
      case 'catalogos': closeSheet(); S.view = 'catalogos'; render(); break;
      case 'ajustes': closeSheet(); S.view = 'ajustes'; render(); break;
      case 'ayuda': helpSheet(); break;
      case 'undo': closeSheet(); $('#toast').hidden = true; if (S.obra) { dialog.handle('deshacer'); render(); } break;
      case 'pdf': { closeSheet(); const o = S.obras.find((x) => x.id === el.dataset.id) || S.obra; if (o) { await loadCatalog(o.catalogo || 'palma48'); exportPdf(o); } break; }
      case 'delobra': { const o = S.obras.find((x) => x.id === el.dataset.id); confirmSheet('¿Borrar la obra «' + o.titulo + '»?', 'Borrar obra', async () => { S.obras = S.obras.filter((x) => x.id !== o.id); await StorageAdapter.del('obras', o.id); if (S.obra && S.obra.id === o.id) S.obra = null; render(); }); break; }
      case 'estancia': if (S.obra.ambito) { VoiceAdapter.stopSpeaking(); dialog.handle('siguiente estancia'); } break;
      case 'close': dialog.handle('siguiente partida'); break;
      case 'addl': editLineSheet(-1, true); break;
      case 'editl': editLineSheet(+el.dataset.i, false); break;
      case 'dell': { const p = dialog.active(); const i = +el.dataset.i; dialog.snapshot(); p.lineas.splice(i, 1); saveObra(); render(); toast('Línea ' + (i + 1) + ' borrada', true); break; }
      case 'goto': S.obra.activa = el.dataset.uid; S.view = 'obra'; saveObra(); render(); { const p = dialog.active(); dialog.state = { mode: 'idle' }; say('Partida ' + p.r + '. Total ' + E.fmt(E.totalOf(p)) + ' ' + E.unitSpoken(p.u) + '. ' + E.dimsSpec(p).ask, dialog.idleChips()); } break;
      case 'fest': S.filterEst = el.dataset.e; render(); break;
      case 'usecat': {
        const id = el.dataset.id; await loadCatalog(id);
        if (S.obra) { S.obra.catalogo = id; saveObra(); } else { S.settings.catalogo = id; saveSettings(); }
        render(); toast('Base de datos activada'); break;
      }
      case 'delcat': { const id = el.dataset.id; confirmSheet('¿Borrar esta base de datos importada?', 'Borrar', async () => { await StorageAdapter.del('catalogos', id); S.cats = S.cats.filter((c) => c.id !== id); S.catsPrepared.delete(id); if (S.settings.catalogo === id) { S.settings.catalogo = 'palma48'; saveSettings(); } render(); }); break; }
      case 'addcat': { const d = catFor(S.obra).byCode.get(el.dataset.code); if (d) { S.view = 'obra'; render(); dialog.pickDoc(d, '', d.r); } break; }
      case 'plan': S.settings.plan = el.dataset.p; await saveSettings(); render(); break;
      case 'unlock': await BillingGuard.unlockObra(S.obra); await saveObra(); render(); toast('Obra desbloqueada: PDF sin marca de agua'); break;
      case 'backup': backup(); break;
    }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'catq') { S.catQ = ev.target.value; $('#catres').innerHTML = catResults(); }
    if (ev.target.id === 'rate') { S.settings.rate = +ev.target.value; VoiceAdapter.setRate(S.settings.rate); ev.target.previousElementSibling.textContent = 'Velocidad de lectura: ' + S.settings.rate.toFixed(2); saveSettings(); }
  });
  document.addEventListener('change', async (ev) => {
    if (ev.target.id === 'selvoice') { S.settings.voice = ev.target.value; VoiceAdapter.setVoice(ev.target.value); saveSettings(); VoiceAdapter.speak('Así sueno ahora.'); }
    if (ev.target.id === 'bc3file' && ev.target.files[0]) importBC3(ev.target.files[0]);
    if (ev.target.id === 'restorefile' && ev.target.files[0]) restore(ev.target.files[0]);
  });
  $('#btnBack').addEventListener('click', () => { if (S.view === 'obra' || !S.obra) goObras(); else { S.view = 'obra'; render(); } });
  $('#btnMenu').addEventListener('click', menuSheet);
  $('#btnSol').addEventListener('click', () => { S.settings.mode = S.settings.mode === 'sol' ? 'obra' : 'sol'; saveSettings(); render(); });
  $('#btnHands').addEventListener('click', () => { S.settings.hands = !S.settings.hands; saveSettings(); renderMic(); });
  $('#btnKeyboard').addEventListener('click', () => { S.typing = !S.typing; renderMic(); if (S.typing) { VoiceAdapter.stopListening(); $('#typein').focus(); } });
  $('#typebar').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#typein').value.trim(); if (!v) return; $('#typein').value = ''; if (!S.session) { VoiceAdapter.unlock(); S.session = true; } VoiceAdapter.stopSpeaking(); dialog.handle(v); });
  $('#btnMic').addEventListener('click', () => {
    // Debe ejecutarse sincrónicamente dentro del gesto del usuario.
    if (!S.session) return startSession();
    if (VoiceAdapter.mode === 'none') { S.typing = true; renderMic(); warnVoice('Este navegador no permite reconocimiento de voz. Usa Chrome (Android) o Safari (iPhone), o escribe las órdenes.'); return; }
    if (VoiceAdapter.listening && !VoiceAdapter.speaking) { VoiceAdapter.stopListening(); return; }
    sayToken++; VoiceAdapter.stopSpeaking(); noSpeech = 0; S.micBlocked = false;
    VoiceAdapter.listen(true);
  });
  $('#btnStart').addEventListener('click', () => startSession());
  function goObras() { S.greetPending = false; VoiceAdapter.stopSpeaking(); VoiceAdapter.stopListening(); sayToken++; S.view = 'obras'; render(); }

  /* ---- Importación de BC3 ---- */
  async function importBC3(file) {
    try {
      toast('Leyendo ' + file.name + '…');
      const buf = new Uint8Array(await file.arrayBuffer());
      const data = window.BC3.parseBC3(buf, file.name.replace(/\.bc3$/i, ''));
      if (!data.partidas.length) return toast('No he encontrado partidas en ese archivo.');
      const id = 'bc3_' + Date.now().toString(36);
      const c = { id, nombre: data.titulo || data.nombre, base: false, n: data.partidas.length, data, fecha: Date.now() };
      await StorageAdapter.put('catalogos', c);
      S.cats.push({ id, nombre: c.nombre, base: false, n: c.n });
      await loadCatalog(id);
      render();
      toast('Importadas ' + data.partidas.length + ' partidas, sin precios');
    } catch (e) { console.error(e); toast('No se pudo leer el archivo BC3: ' + e.message); }
  }
  async function saveFile(name, blob) {
    try {
      if (window.claude && window.claude.use) {
        const d = await Promise.race([window.claude.use('downloads'), new Promise((r) => setTimeout(() => r(null), 3000))]);
        if (d) { await d.save({ filename: name, data: blob }); return true; }
      }
    } catch (e) { if (e && e.code === 'declined') return false; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return true;
  }
  async function backup() {
    const data = { app: 'mediciones-voz', v: 1, fecha: new Date().toISOString(), obras: await StorageAdapter.all('obras'), catalogos: (await StorageAdapter.all('catalogos')).filter((c) => !c.base) };
    await saveFile('mediciones-copia-' + new Date().toISOString().slice(0, 10) + '.json', new Blob([JSON.stringify(data)], { type: 'application/json' }));
  }
  async function restore(file) {
    try {
      const d = JSON.parse(await file.text());
      for (const o of d.obras || []) { await StorageAdapter.put('obras', o); if (!S.obras.some((x) => x.id === o.id)) S.obras.push(o); }
      for (const c of d.catalogos || []) { await StorageAdapter.put('catalogos', c); if (!S.cats.some((x) => x.id === c.id)) S.cats.push({ id: c.id, nombre: c.nombre, base: false, n: c.n }); }
      toast('Copia restaurada'); render();
    } catch (e) { toast('El archivo no es una copia válida.'); }
  }

  /* ============================================================
   * EXPORTADOR PDF — Estado de mediciones (formato Presto/Arquímedes)
   * ============================================================ */
  async function exportPdf(obra) {
    if (!obra) return;
    const J = window.jspdf && window.jspdf.jsPDF;
    if (!J) return toast('El generador de PDF no está disponible.');
    const doc = buildPdf(obra, J);
    const name = 'Mediciones_' + obra.titulo.replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, '_').slice(0, 60) + '.pdf';
    const ok = await saveFile(name, doc.output('blob'));
    if (ok) toast('PDF generado: ' + name);
  }
  function buildPdf(obra, J) {
    const doc = new J({ unit: 'mm', format: 'a4' });
    const caps = E.obraChapters(obra).map((c) => Object.assign({}, c, { partidas: c.partidas.filter((p) => p.lineas.length) })).filter((c) => c.partidas.length);
    const M = 12, W = 210, R = W - M, BOTTOM = 280;
    const X = { cod: M, ud: 30, res: 40, uds: 113, l: 130, a: 147, h: 164, par: 181, tot: R };
    const fecha = new Date().toLocaleDateString('es-ES');
    let y = 0;
    const txt = (s) => String(s ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '');
    const right = (s, x, yy) => doc.text(txt(s), x, yy, { align: 'right' });
    function header() {
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(txt(obra.titulo), M, 14, { maxWidth: 130 });
      doc.setFontSize(10); right('ESTADO DE MEDICIONES', R, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(txt([obra.cliente, obra.ubicacion].filter(Boolean).join(' · ')), M, 19);
      right(fecha, R, 19);
      doc.setDrawColor(15, 23, 42); doc.setLineWidth(0.4); doc.line(M, 21, R, 21);
      doc.setFillColor(30, 41, 59); doc.rect(M, 23, R - M, 6, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.text('Código', X.cod + 1, 27); doc.text('Ud', X.ud, 27); doc.text('Resumen / Comentario', X.res, 27);
      right('Uds.', X.uds, 27); right('Longitud', X.l, 27); right('Anchura', X.a, 27); right('Altura', X.h, 27); right('Parcial', X.par, 27); right('Total', X.tot - 1, 27);
      doc.setTextColor(15, 23, 42);
      y = 34;
    }
    function newPage() { doc.addPage(); header(); }
    function carryRow(label, val) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(71, 85, 105);
      right(label, X.par, y); doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42); right(E.fmt(val), X.tot, y);
      y += 4.5;
    }
    header();
    if (!caps.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text('La obra no tiene partidas con mediciones.', M, y + 4); }
    caps.forEach((c) => {
      if (y + 22 > BOTTOM) newPage();
      doc.setFillColor(226, 232, 240); doc.rect(M, y - 4, R - M, 6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(15, 23, 42);
      doc.text(txt('Capítulo ' + c.codigo), X.cod + 1, y); doc.text(txt(c.titulo.toUpperCase()), X.res, y);
      y += 7;
      c.partidas.forEach((p) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        const resL = doc.splitTextToSize(txt(p.r), R - X.res);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        const desc = p.t && p.t !== p.r ? doc.splitTextToSize(txt(p.t), R - X.res) : [];
        const headH = resL.length * 4 + desc.length * 3 + 5;
        if (y + headH + 10 > BOTTOM) newPage();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
        doc.text(txt(p.codigo), X.cod, y); doc.setFont('helvetica', 'normal'); doc.text(txt(E.unitLabel(p.u)), X.ud, y);
        doc.setFont('helvetica', 'bold'); doc.text(resL, X.res, y); y += resL.length * 4;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139);
        doc.text(txt(p.ref + (p.propia ? ' (partida creada en obra)' : '')), X.cod, y);
        if (desc.length) { doc.setFontSize(7); doc.setTextColor(51, 65, 85); }
        // descripción con posible salto de página
        for (let k = 0; k < desc.length; k++) {
          if (y + 3 > BOTTOM) { newPage(); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(51, 65, 85); }
          doc.text(desc[k], X.res, y); y += 3;
        }
        y += 2;
        let run = 0;
        doc.setTextColor(15, 23, 42);
        p.lineas.forEach((l, idx) => {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
          const com = doc.splitTextToSize(txt([l.est, l.com].filter(Boolean).join(' - ')), X.uds - 14 - X.res);
          const h = Math.max(1, com.length) * 3.6 + 0.8;
          if (y + h + (idx === p.lineas.length - 1 ? 9 : 0) > BOTTOM) {
            carryRow('Suma y sigue ......', run);
            newPage(); carryRow('Suma anterior ......', run);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
          }
          const neg = (l.uds || 0) < 0;
          doc.setTextColor(neg ? 185 : 15, neg ? 28 : 23, neg ? 28 : 42);
          doc.text(com.length ? com : [''], X.res, y);
          if (l.uds !== null && l.uds !== undefined) right(E.fmtUds(l.uds).replace(/^(-?\d+)$/, '$1'), X.uds, y);
          if (l.l !== null && l.l !== undefined) right(E.fmt(l.l), X.l, y);
          if (l.a !== null && l.a !== undefined) right(E.fmt(l.a), X.a, y);
          if (l.h !== null && l.h !== undefined) right(E.fmt(l.h), X.h, y);
          const pv = E.parcial(l); run = E.round2(run + pv);
          right(E.fmt(pv), X.par, y);
          y += h;
        });
        doc.setTextColor(15, 23, 42);
        doc.setDrawColor(100, 116, 139); doc.setLineWidth(0.2); doc.line(X.h + 2, y - 2.6, R, y - 2.6);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        right('Total ' + E.unitLabel(p.u) + ' ......:', X.par, y + 0.8); right(E.fmt(E.totalOf(p)), X.tot, y + 0.8);
        y += 5;
        doc.setDrawColor(203, 213, 225); doc.line(M, y - 1.5, R, y - 1.5);
        y += 3.5;
      });
      y += 2;
    });
    // Resumen final
    if (caps.length) {
      newPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('RESUMEN DE MEDICIONES', M, y); y += 7;
      caps.forEach((c) => {
        if (y + 12 > BOTTOM) newPage();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.text(txt(c.codigo + '  ' + c.titulo.toUpperCase()), M, y); y += 4.8;
        c.partidas.forEach((p) => {
          if (y + 4 > BOTTOM) newPage();
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
          doc.text(txt(p.codigo), M + 2, y); doc.text(txt(E.unitLabel(p.u)), X.ud, y);
          const r1 = doc.splitTextToSize(txt(p.r), X.par - X.res - 6)[0];
          doc.text(r1, X.res, y); doc.setFont('helvetica', 'bold'); right(E.fmt(E.totalOf(p)), X.tot, y);
          y += 4.4;
        });
        y += 2;
      });
    }
    // Pie, numeración y marca de agua
    const n = doc.getNumberOfPages();
    const wm = BillingGuard.watermark(obra);
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setDrawColor(203, 213, 225); doc.setLineWidth(0.2); doc.line(M, 287, R, 287);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(100, 116, 139);
      doc.text(txt('Mediciones por voz · ' + obra.titulo + ' · Base: ' + ((catFor(obra) || {}).nombre || '')), M, 291, { maxWidth: 150 });
      right('Página ' + i + ' de ' + n, R, 291);
      if (wm) {
        try { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.13 })); } catch (e) {}
        doc.setFont('helvetica', 'bold'); doc.setFontSize(54); doc.setTextColor(239, 68, 68);
        doc.text('VERSIÓN DEMO', 105, 160, { align: 'center', angle: 35 });
        try { doc.restoreGraphicsState(); } catch (e) {}
      }
    }
    return doc;
  }

  /* ============================================================
   * Obra de ejemplo (primer arranque)
   * ============================================================ */
  function exampleObra(cat) {
    const mk = (code) => { const d = cat.byCode.get(code); if (!d) return null; const p = { uid: 'p' + code, ref: d.c, u: d.u, r: d.r, t: d.t, chap: d.chap, chapTitle: d.chapTitle, chapOrder: d.chapOrder, subTitle: d.subTitle, lineas: [], creada: Date.now() }; p.orient = E.orientOf(p); return p; };
    const o = { id: 'obra_ejemplo', ejemplo: true, titulo: 'Ejemplo · Reforma Calle Mayor 14', cliente: 'Cliente de ejemplo', ubicacion: 'Palma', ambito: 'vivienda', estActiva: 'Baño 1', estancias: ['Cocina', 'Baño 1'], partidas: [], activa: null, catalogo: 'palma48', created: Date.now(), updated: Date.now() };
    const dem = mk('DRA010'); const sol = mk('RSG010h'); const pin = mk('RIP030');
    if (dem) { dem.lineas = [{ id: 1, est: 'Cocina', com: 'Pared frontal', uds: 1, l: 3.4, a: null, h: 2.5 }, { id: 2, est: 'Baño 1', com: 'Pared ducha', uds: 1, l: 1.8, a: null, h: 2.5 }, { id: 3, est: 'Baño 1', com: 'Deducción puerta', uds: -1, l: 0.72, a: null, h: 2.03 }]; o.partidas.push(dem); }
    if (sol) { sol.lineas = [{ id: 1, est: 'Cocina', com: '', uds: 1, l: 3.2, a: 2.6, h: null }, { id: 2, est: 'Baño 1', com: '', uds: 1, l: 2.1, a: 1.7, h: null }]; o.partidas.push(sol); }
    if (pin) { pin.lineas = [{ id: 1, est: 'Cocina', com: 'Techo', uds: 1, l: 3.2, a: 2.6, h: null, grp: 'H' }]; o.partidas.push(pin); }
    o.activa = dem ? dem.uid : null;
    return o;
  }

  /* ============================================================
   * Arranque
   * ============================================================ */
  async function boot() {
    const st = await StorageAdapter.get('ajustes', 'settings');
    if (st) Object.assign(S.settings, st);
    BillingGuard.plan = S.settings.plan; VoiceAdapter.setRate(S.settings.rate); if (S.settings.voice) VoiceAdapter.setVoice(S.settings.voice);
    // Catálogo base embebido → IndexedDB en el primer arranque
    let cats = await StorageAdapter.all('catalogos');
    if (!cats.some((c) => c.id === 'palma48')) { await StorageAdapter.put('catalogos', baseCatalog()); }
    S.cats = [{ id: 'palma48', nombre: baseCatalog().nombre, base: true, n: window.CATALOGO_BASE.partidas.length }].concat(cats.filter((c) => !c.base).map((c) => ({ id: c.id, nombre: c.nombre, base: false, n: c.n })));
    const cat = await loadCatalog('palma48');
    if (S.settings.catalogo !== 'palma48') await loadCatalog(S.settings.catalogo).catch(() => {});
    S.obras = await StorageAdapter.all('obras');
    if (!S.obras.length && !st) { const ex = exampleObra(cat); S.obras.push(ex); await StorageAdapter.put('obras', ex); await saveSettings(); }
    render();
    VoiceAdapter.init().then((m) => {
      if (m === 'none') {
        S.typing = true;
        warnVoice(window.claude ? 'Dentro de la app de Claude el micrófono no está disponible. Para medir por voz abre la app desde su propia dirección en Chrome (Android) o Safari (iPhone). Aquí puedes escribir.' : 'Este navegador no ofrece reconocimiento de voz: escribe las órdenes. Con voz funciona en Chrome (Android/PC) y Safari (iPhone).');
      }
      render();
    });
  }
  window.MedicionesApp = { S, dialog, buildPdf, exportPdf };
  boot();
})();

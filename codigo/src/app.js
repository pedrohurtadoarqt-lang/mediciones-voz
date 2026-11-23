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
    let pitchQ = true;
    let voice = null, rate = 1.05, gotFinal = false, buf = '', bufTimer = null, lastPartial = '';
    let micState = 'unknown'; // unknown | granted | denied | unavailable
    let needTap = false, autoRestarts = 0, retried = false, echoOn = true;
    function pickVoice(uri) {
      if (!synth) return;
      const vs = synth.getVoices().filter((v) => /^es/i.test(v.lang));
      // Se elige la voz más natural disponible: neuronales/«mejoradas» > de red > español de España
      const score = (v) => (/natural|neural|online|premium|mejorad|enhanced|wavenet/i.test(v.name) ? 8 : 0) + (v.localService === false ? 3 : 0) +
        (/es-ES/i.test(v.lang) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (/elvira|alvaro|álvaro|monica|mónica|lucia|lucía|marisol|helena|jorge/i.test(v.name) ? 1 : 0) - (/compact|eloquence|espeak|sandy|shelley|grandma|grandpa|rocko|flo|reed|eddy/i.test(v.name) ? 6 : 0);
      const best = vs.slice().sort((a, b) => score(b) - score(a))[0] || null;
      voice = vs.find((v) => v.voiceURI === uri) || best;
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
    // Pitido corto y ascendente: «te toca hablar» (la voz del móvil apenas entona las preguntas)
    let actx = null;
    function audioCtx() {
      try { if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); } if (actx && actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; }
      return actx;
    }
    function earcon() {
      return new Promise((resolve) => {
        const c = audioCtx(); if (!c) return resolve();
        try {
          const t = c.currentTime + 0.02;
          [[660, 0], [990, 0.11]].forEach(([f, d]) => {
            const o = c.createOscillator(), g = c.createGain();
            o.type = 'sine'; o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.22, t + d + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.1);
            o.connect(g).connect(c.destination); o.start(t + d); o.stop(t + d + 0.11);
          });
        } catch (e) {}
        setTimeout(() => { soltarAudio(); setTimeout(resolve, 120); }, 300);
      });
    }
    function unlock() {
      audioCtx();
      if (unlocked || !synth) return;
      try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; u.lang = 'es-ES'; synth.speak(u); unlocked = true; } catch (e) {}
    }
    function splitSentences(t) { return (t.match(/[^.?!;]+[.?!;]*/g) || [t]).map((s) => s.trim()).filter(Boolean); }
    let speakId = 0;
    // Voz natural en la nube: si responde rápido se usa; si no, la voz del móvil
    let cloudTTS = null, fuente = null;
    const cacheVoz = new Map();
    /** Suelta el audio del navegador (en Android, si sigue activo, el micro no se abre). */
    function soltarAudio() { try { if (actx && actx.state === 'running' && !fuente) actx.suspend(); } catch (e) {} }
    function b64bytes(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    async function bufferDe(r) {
      const c = audioCtx(); if (!c) return null;
      if (c.state === 'suspended') { try { await c.resume(); } catch (e) {} }
      const u = b64bytes(r.audio);
      // WAV (lo que devuelven los modelos actuales) o PCM de 16 bits sin cabecera
      if (u[0] === 82 && u[1] === 73 && u[2] === 70 && u[3] === 70) return await new Promise((ok) => { try { c.decodeAudioData(u.buffer.slice(0), ok, () => ok(null)); } catch (e) { ok(null); } });
      const n = u.length >> 1, buf = c.createBuffer(1, n, r.rate || 24000), ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) { let v = u[2 * i] | (u[2 * i + 1] << 8); if (v >= 32768) v -= 65536; ch[i] = v / 32768; }
      return buf;
    }
    async function playBuffer(r, my) {
      const c = audioCtx(); if (!c) return false;
      const buf = await bufferDe(r); if (!buf || my !== speakId) return !!buf;
      return await new Promise((resolve) => {
        try {
          const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination);
          fuente = src;
          let hecho = false; const fin = () => { if (hecho) return; hecho = true; if (fuente === src) fuente = null; resolve(true); };
          src.onended = fin;
          setTimeout(fin, buf.duration * 1000 + 1500); // por si no llega el aviso de fin
          src.start();
        } catch (e) { resolve(false); }
      });
    }
    /** Trozos para empezar a hablar antes: la primera frase y el resto. */
    function trozos(t) {
      const fr = (t.match(/[^.!?]+[.!?]*/g) || [t]).map((x) => x.trim()).filter(Boolean);
      if (fr.length <= 1) return [t];
      let a = fr.shift(); while (fr.length && a.length < 30) a += ' ' + fr.shift();
      return fr.length ? [a, fr.join(' ')] : [a];
    }
    function pedirVoz(t, ms) {
      if (cacheVoz.has(t)) return Promise.resolve(cacheVoz.get(t));
      return Promise.race([Promise.resolve().then(() => cloudTTS(t)).then((r) => { if (r && r.audio) { cacheVoz.set(t, r); if (cacheVoz.size > 40) cacheVoz.delete(cacheVoz.keys().next().value); } return r; }).catch(() => null), new Promise((res) => setTimeout(() => res(null), ms))]);
    }
    async function speakCloud(text) {
      const my = ++speakId;
      if (mode === 'native' && listening) { try { rec && rec.abort(); } catch (e) {} listening = false; }
      speaking = true; lastSaid = text; state();
      const partes = trozos(text);
      const proms = partes.map((t, i) => pedirVoz(t, i ? 12000 : 7000)); // se piden a la vez
      for (let i = 0; i < partes.length; i++) {
        const r = await proms[i];
        if (my !== speakId) return true; // interrumpido
        if (!r || !r.audio || !(await playBuffer(r, my))) {
          if (i === 0) { speaking = false; state(); return false; }
          speaking = false; await speakLocal(partes.slice(i).join(' ')); return true;
        }
        if (my !== speakId) return true;
      }
      soltarAudio();
      await new Promise((r) => setTimeout(r, 150));
      lastStop = Date.now();
      if (my === speakId) { speaking = false; state(); }
      return true;
    }
    async function speak(text) {
      if (text) text = text.replace(/(\d+),00\b/g, '$1').replace(/«|»/g, '');
      if (text && cloudTTS && navigator.onLine !== false) { if (await speakCloud(text)) return; }
      return speakLocal(text);
    }
    function speakLocal(text) {
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
        speaking = true; lastSaid = text; state();
        let i = 0, done = false, poll = null, cur = null;
        const finish = () => { if (done) return; done = true; clearInterval(poll); lastStop = Date.now(); if (my === speakId) { speaking = false; state(); } resolve(); };
        const guard = setTimeout(finish, 4000 + text.length * 95);
        // En muchos Android el aviso de «fin de frase» no llega nunca: se comprueba si sigue hablando
        const t0 = Date.now(); let quieto = 0;
        poll = setInterval(() => {
          if (done) return;
          if (my !== speakId) { clearTimeout(guard); return finish(); }
          if (Date.now() - t0 < 450) return;
          if (!synth.speaking && !synth.pending) { if (++quieto >= 2) { quieto = 0; cur = null; if (i < parts.length) next(); else { clearTimeout(guard); finish(); } } }
          else quieto = 0;
        }, 150);
        const next = () => {
          if (done) return;
          if (my !== speakId) { clearTimeout(guard); return finish(); } // interrumpido: no se leen las frases que faltan
          if (i >= parts.length) { clearTimeout(guard); return setTimeout(finish, 60); }
          const frase = parts[i++];
          const u = new SpeechSynthesisUtterance(frase);
          u.lang = 'es-ES'; if (voice) u.voice = voice; u.rate = rate;
          if (pitchQ && /\?\s*$/.test(frase)) { u.pitch = 1.08; } // la pregunta, algo más aguda y pausada
          cur = u;
          u.onend = () => { if (cur === u) { cur = null; next(); } }; u.onerror = () => { if (cur === u) { clearTimeout(guard); finish(); } };
          synth.speak(u);
          // Chrome Android a veces deja la síntesis en pausa
          try { if (synth.paused) synth.resume(); } catch (e) {}
        };
        next();
      });
    }
    let lastSaid = '', lastStop = 0;
    /** ¿Lo oído es la propia voz de la app (eco del altavoz)? */
    function isEcho(heard) {
      if (!echoOn || !lastSaid || Date.now() - lastStop > 3500) return false;
      const w = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9ñ]+/).filter((x) => x.length > 2);
      const h = w(heard); if (h.length < 3) return false;
      const said = new Set(w(lastSaid));
      return h.filter((x) => said.has(x)).length / h.length >= 0.75;
    }
    function stopSpeaking() { if (fuente) { try { fuente.stop(); } catch (e) {} fuente = null; } if (speaking) lastStop = Date.now(); speakId++; if (synth) try { synth.cancel(); } catch (e) {} if (tts) try { tts.stop(); } catch (e) {} speaking = false; state(); }
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
        rec.onstart = () => { micState = 'granted'; listening = true; needTap = false; retried = false; autoRestarts = 0; state(); };
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
            if (micState === 'granted' && !fromTap) { // iPhone: se reintenta una vez; si vuelve a fallar, se pide un toque
              if (!retried) { retried = true; setTimeout(() => { if (!speaking && !listening) listen(false); }, 700); return; }
              needTap = true; state(); return;
            }
            micState = 'denied';
          }
          if (code === 'aborted') return;
          if (code === 'audio-capture' && !fromTap && autoRestarts < 3) { autoRestarts++; soltarAudio(); setTimeout(() => { if (!speaking && !listening) listen(false); }, 500); return; }
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
        // El reconocedor anterior aún no había terminado: se reintenta antes de pedir un toque
        if (!fromTap && autoRestarts < 3) { autoRestarts++; setTimeout(() => { if (!speaking && !listening) listen(false); }, 400); }
        else if (!fromTap) needTap = true;
        state();
      }
    }
    function stopListening() { needTap = false; if (mode === 'claude') { dict && dict.stop().catch(() => {}); return; } try { rec && rec.abort(); } catch (e) {} listening = false; state(); }
    return {
      init, speak, stopSpeaking, listen, stopListening, unlock, isEcho, setEcho(v) { echoOn = v; }, earcon, setPitchQ(v) { pitchQ = v; },
      on(c) { cb = Object.assign(cb, c); },
      get mode() { return mode; }, get listening() { return listening; }, get speaking() { return speaking; },
      get needTap() { return needTap; }, set needTap(v) { needTap = v; state(); },
      get micState() { return micState; }, get inFrame() { return inFrame; },
      setRate(r) { rate = r; }, setVoice(uri) { pickVoice(uri); }, setCloudTTS(fn) { cloudTTS = fn; cacheVoz.clear(); },
      voices() { return synth ? synth.getVoices().filter((v) => /^es/i.test(v.lang)) : []; },
      get voiceName() { return voice ? voice.name : ''; },
      get voiceURI() { return voice && voice.voiceURI; },
      canSpeak: !!(synth)
    };
  })();

  /* ============================================================
   * Estado de la app
   * ============================================================ */
  const S = {
    view: 'obras', obra: null, obras: [], cats: [], catsPrepared: new Map(), activeCat: 'palma48',
    settings: { mode: 'obra', hands: true, plan: 'demo', rate: 1.05, voice: null, catalogo: 'palma48', confirm: true },
    log: [], chips: [], chipsLong: false, partial: '', filterEst: null, lastLineId: null, typing: false
  };
  const dialog = new E.Dialog({
    say: (text, chips, opts) => say(text, chips, opts),
    user: (text) => { S.log.push({ who: 'user', text }); logObra('user', text); S.partial = ''; renderTalk(); },
    save: () => saveObra(),
    render: () => render(),
    getCatalog: () => catFor(S.obra),
    exportPdf: () => exportPdf(S.obra),
    exportXlsx: () => exportFile(S.obra, 'xlsx'),
    sendEmail: () => sendSheet(S.obra),
    exportBc3: () => exportFile(S.obra, 'bc3'),
    shareFiles: () => shareSheet(S.obra),
    aiReady: () => S.settings.ia !== false && !!(window.Cloud && Cloud.user) && navigator.onLine !== false,
    ai: (ctx) => Cloud.ai(ctx),
    agent: (ctx) => Cloud.agent(ctx),
    conversa: (ctx) => Cloud.conversa(ctx),
    esAdmin: () => !!(window.Cloud && Cloud.isAdmin),
    historial: () => S.log.filter((m) => !/^(Tomando nota|Sigo con ello|Pensando|Lo consulto|\(IA:)/.test(m.text || '')).slice(-10).map((m) => ({ who: m.who === 'user' ? 'user' : 'app', text: String(m.text || '').slice(0, 400) })),
    history: () => S.log.filter((m) => !m.svg).slice(-6),
    flash: (k) => { const p = dialog.active(); if (p && p.lineas.length) S.lastLineId = p.lineas[p.lineas.length - 1].id; render(); const t = $('.total'); if (t) { t.classList.add('flash-' + k); setTimeout(() => t.classList.remove('flash-' + k), 900); } },
    filterEst: (e) => { S.filterEst = e; },
    note: (t) => { S.log.push({ who: 'app', text: t }); logObra('app', t); renderTalk(); },
    // Croquis de la planta: solo en la conversación (se guarda en la obra; no va en el PDF ni en los archivos)
    sketch: (svg, titulo) => { if (!svg) return; S.log.push({ who: 'app', text: titulo || 'Planta', svg }); renderTalk(); },
    confirmPick: () => S.settings.confirm !== false,
    breve: () => S.settings.breve === true,
    setBreve: (v) => { S.settings.breve = !!v; saveSettings(); if (S.view === 'ajustes') render(); },
    // Asistente guiado: abre o cierra la pantalla de selección de trabajos
    trabajos: (on) => { S.view = on ? 'trabajos' : 'obra'; S.tq = ''; render(); },
    pause: () => { sayToken++; VoiceAdapter.stopSpeaking(); VoiceAdapter.stopListening(); VoiceAdapter.needTap = true; }
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
  function baseCatalog() { return { id: 'palma48', nombre: 'Base de partidas Mediciona', base: true, n: window.CATALOGO_BASE.partidas.length, data: window.CATALOGO_BASE, fecha: Date.now() }; }

  async function saveObra() { if (!S.obra) return; S.obra.updated = Date.now(); if (window.Cloud && Cloud.user && !S.obra.owner && !S.obra.ejemplo) S.obra.owner = Cloud.user.id; await StorageAdapter.put('obras', JSON.parse(JSON.stringify(S.obra))); if (window.Cloud) Cloud.queue(S.obra); }
  async function saveSettings() { BillingGuard.plan = S.settings.plan; await StorageAdapter.put('ajustes', S.settings, 'settings'); }

  /* ============================================================
   * Diálogo: salida de voz y bocadillos
   * ============================================================ */
  /** Registro de la conversación guardado en la obra (para revisar fallos). */
  function logObra(who, text) {
    if (!S.obra) return;
    const lg = S.obra.registro || (S.obra.registro = []);
    const p = dialog.active && dialog.active();
    lg.push({ t: new Date().toISOString(), who, text, est: S.obra.estActiva || '', partida: p ? p.ref + ' ' + p.r : '' });
    if (lg.length > 1500) lg.splice(0, lg.length - 1500);
  }
  let sayToken = 0;
  /** Voz natural (nube) si hay cuenta y está activada en Ajustes. */
  function configurarVoz() {
    const on = S.settings.vozNatural !== false && window.Cloud && Cloud.user && Cloud.voz;
    VoiceAdapter.setCloudTTS(on ? (t) => Cloud.voz(t, S.settings.vozNombre || 'Kore') : null);
  }
  const vozVista = () => S.view === 'obra' || S.view === 'trabajos';
  async function say(text, chips, opts) {
    opts = opts || {};
    if (!opts.repeat) logObra('app', text);
    const last = S.log[S.log.length - 1];
    if (!(last && last.who === 'app' && last.text === text && opts.repeat)) S.log.push({ who: 'app', text });
    if (S.log.length > 40) S.log.splice(0, S.log.length - 40);
    S.chips = chips || []; S.chipsLong = !!opts.long || S.chips.some((c) => (c.label || '').length > 34);
    renderTalk(); renderChips();
    if (!S.session) return; // hasta el primer toque el navegador no deja hablar ni escuchar
    const tk = ++sayToken;
    if (opts.end) VoiceAdapter.stopListening();
    await VoiceAdapter.speak(opts.voz || text);
    if (opts.end) { endVoiceSession(); return; }
    if (tk !== sayToken) return;
    // Al acabar una pregunta, pitido de «te toca»
    if (S.settings.tono !== false && /\?/.test(text) && opts.listen !== false) { await VoiceAdapter.earcon(); if (tk !== sayToken) return; }
    if (vozVista() && S.settings.hands && opts.listen !== false && !S.typing) { noSpeech = 0; reabrir(tk); }
  }
  /** Reabre el micro tras hablar. Con auriculares Bluetooth se espera a que el móvil cambie el audio a modo llamada. */
  function reabrir(tk) {
    const ms = auriculares() ? 700 : 0;
    const go = () => { if ((tk === undefined || tk === sayToken) && !VoiceAdapter.speaking && !VoiceAdapter.listening && vozVista() && S.session) VoiceAdapter.listen(false); };
    if (ms) setTimeout(go, ms); else go();
  }
  const auriculares = () => S.settings.auriculares === true || (S.settings.auriculares !== false && S.btDetectado);
  /** Detecta auriculares o manos libres conectados (los nombres solo se ven tras dar permiso al micro). */
  async function detectarAuriculares() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      const ds = await navigator.mediaDevices.enumerateDevices();
      const antes = S.btDetectado;
      S.btDetectado = ds.some((d) => (d.kind === 'audioinput' || d.kind === 'audiooutput') && /bluetooth|airpods|buds|auriculares|headphones|manos libres|\bbt\b|jabra|bose|sony|beats|jbl|plantronics|\bpoly\b/i.test(d.label || '') && !/earpiece|speakerphone|altavoz|default|predeterminado|communications/i.test(d.label || ''));
      if (S.btDetectado !== antes) { VoiceAdapter.setEcho(!auriculares()); if (S.view === 'ajustes') render(); }
    } catch (e) {}
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', detectarAuriculares);
  /* ---- Pantalla siempre encendida mientras se mide (Screen Wake Lock) ---- */
  let wakeLock = null;
  async function keepAwake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { wakeLock = null; }
  }
  function releaseAwake() { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.session && vozVista()) {
      keepAwake();
      if (S.settings.hands && !VoiceAdapter.listening && !VoiceAdapter.speaking) { noSpeech = 0; VoiceAdapter.listen(false); }
    }
  });
  function endVoiceSession() {
    VoiceAdapter.stopListening();
    S.session = false; S.greetPending = false; S.ended = true;
    releaseAwake();
    render();
  }
  /** Primer toque: desbloquea audio, pide permiso de micrófono y empieza la conversación guiada. */
  function startSession() {
    VoiceAdapter.unlock();
    setTimeout(detectarAuriculares, 1500);
    keepAwake();
    const resume = S.ended; S.ended = false;
    S.session = true; S.greetPending = true;
    if (resume) { S.greetPending = false; VoiceAdapter.listen(true); dialog.handle('seguir midiendo'); render(); return; }
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
    onFinal(t) {
      noSpeech = 0; S.partial = ''; if (S.greetPending) return;
      if (VoiceAdapter.isEcho(t)) { renderTalk(); return setTimeout(() => { if (!VoiceAdapter.speaking && vozVista()) VoiceAdapter.listen(false); }, 200); }
      if (vozVista()) { sayToken++; VoiceAdapter.stopSpeaking(); dialog.handle(t); } },
    onState(st) {
      renderMic();
      if (S.greetPending && st.listening && VoiceAdapter.micState === 'granted') greet();
    },
    onError(code) {
      if (code === 'no-speech') {
        if (S.settings.hands && S.session && ++noSpeech < 25) return setTimeout(() => { if (!VoiceAdapter.speaking && vozVista()) VoiceAdapter.listen(false); }, auriculares() ? 400 : 250);
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
    onEnd(got) { S.partial = ''; renderTalk(); if (!got && S.session && S.settings.hands && !VoiceAdapter.speaking && vozVista()) { if (++noSpeech < 25) setTimeout(() => { if (!VoiceAdapter.speaking && !VoiceAdapter.listening && vozVista()) VoiceAdapter.listen(false); }, auriculares() ? 400 : 150); else VoiceAdapter.needTap = true; } }
  });
  function hideWarn() { const w = $('#voicewarn'); if (w) w.hidden = true; }
  function warnVoice(t) { const w = $('#voicewarn'); w.textContent = t; w.hidden = false; }

  /* ============================================================
   * Render
   * ============================================================ */
  function render() {
    document.documentElement.dataset.mode = S.settings.mode === 'sol' ? 'sol' : '';
    document.getElementById('app').dataset.view = S.view;
    $('#btnSol').setAttribute('aria-pressed', S.settings.mode === 'sol');
    $('#btnBack').hidden = S.view === 'obras';
    $('#btnHelp').setAttribute('aria-pressed', S.view === 'manual');
    $('#dock').hidden = !vozVista();
    const v = $('#view');
    const t = $('#title');
    if (S.view === 'obras') { t.innerHTML = '<span class="brandtitle">Mediciona</span><small>Mediciones de obra con IA</small>'; v.innerHTML = viewObras(); }
    else if (S.view === 'obra') { t.innerHTML = esc(S.obra.titulo) + '<small>' + esc([S.obra.cliente, S.obra.ubicacion].filter(Boolean).join(' · ') || 'Obra') + '</small>'; v.innerHTML = viewObra(); }
    else if (S.view === 'trabajos') { t.innerHTML = 'Trabajos a realizar<small>' + esc(S.obra.titulo) + '</small>'; v.innerHTML = viewTrabajos(); }
    else if (S.view === 'resumen') { t.innerHTML = 'Resumen<small>' + esc(S.obra.titulo) + '</small>'; v.innerHTML = viewResumen(); }
    else if (S.view === 'catalogos') { t.innerHTML = 'Bases de datos BC3<small>Sin precios: código, unidad, resumen y texto</small>'; v.innerHTML = viewCatalogos(); }
    else if (S.view === 'ajustes') { t.innerHTML = 'Ajustes'; v.innerHTML = viewAjustes(); }
    else if (S.view === 'manual') { t.innerHTML = 'Cómo se usa<small>Guía rápida de Mediciona</small>'; v.innerHTML = viewManual(); }
    else if (S.view === 'admin') { t.innerHTML = '<span class="brandtitle">Administración</span><small>Usuarios, sugerencias e IA</small>'; v.innerHTML = viewAdmin(); }
    renderMic();
    if (vozVista()) { renderTalk(); renderChips(); const nr = $('tr.new'); if (nr) nr.scrollIntoView({ block: 'nearest' }); }
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
    const toma = (o.toma && o.toma.zonas) || [];
    if (!p && (toma.length || (o.guia && o.guia.paso && !o.guia.fin))) {
      mon = viewToma(o);
    } else if (!p) {
      const n = o.partidas.filter((x) => x.lineas.length).length;
      mon = '<section class="monitor"><div class="code">SIN PARTIDA ACTIVA</div><p class="empty">Pulsa el micrófono y di el trabajo a medir, por ejemplo <strong>«picado de azulejos»</strong> o <strong>«pintura plástica en techo»</strong>. Después dicta las medidas: <strong>«pared ducha 1,80 por 2,50»</strong>.</p>' +
        (dialog.guia ? '<p class="empty"><button class="btn small primary" data-a="guiada">Medición guiada paso a paso</button></p>' : '') + (n ? '<p class="empty">La obra lleva ' + n + ' partida' + (n === 1 ? '' : 's') + ' medida' + (n === 1 ? '' : 's') + '. <button class="btn small" data-a="resumen">Ver resumen</button></p>' : '') + '</section>';
    } else {
      const spec = E.dimsSpec(p);
      const used = { l: p.u === 'm' || p.u === 'm2' || p.u === 'm3', a: p.u === 'm3' || (p.u === 'm2'), h: p.u === 'm3' || p.u === 'm2' };
      const rows = p.lineas.map((l, i) => {
        const cell = (k) => (k === 'h' && l.hPend && (l.h === null || l.h === undefined)) ? '<td class="pend">falta</td>' : (l[k] === null || l[k] === undefined) ? '<td class="blk">' + (used[k] ? '·' : '—') + '</td>' : '<td>' + E.fmt(l[k]) + '</td>';
        const neg = (l.uds || 0) < 0;
        return '<tr class="' + (neg ? 'neg ' : '') + (l.id === S.lastLineId ? 'new' : '') + '"><td>' + (i + 1) + '</td><td class="com">' + (l.est ? '<span class="e">' + esc(l.est) + '</span>' : '') + esc(l.com || '') + '</td>' +
          '<td>' + E.fmtUds(l.uds) + '</td>' + cell('l') + cell('a') + cell('h') + '<td class="p">' + (l.hPend && l.h == null ? '<span class="pend">—</span>' : E.fmt(E.parcial(l))) + '</td>' +
          '<td><div class="rowbtns"><button data-a="editl" data-i="' + i + '" aria-label="Editar línea ' + (i + 1) + '">' + ICON.edit + '</button><button data-a="dell" data-i="' + i + '" aria-label="Borrar línea ' + (i + 1) + '">' + ICON.del + '</button></div></td></tr>';
      }).join('');
      mon = '<section class="monitor"><div class="mon-head"><div class="left"><div class="code"><b>' + esc(p.codigo || '') + '</b> · ' + esc(p.ref) + ' · ' + esc(p.chapTitle) + '</div><button class="resumen linklike" data-a="pickp" aria-label="Cambiar partida">' + esc(p.r) + ' <span class="edit-hint">cambiar</span></button></div>' +
        '<div class="total"><div class="lbl">Total</div><span class="big num">' + E.fmt(E.totalOf(p)) + '</span><span class="u">' + unitL(p.u) + '</span></div></div>' +
        (p.lineas.length ? '<div class="tablewrap"><table class="lines"><thead><tr><th>#</th><th>Estancia / comentario</th><th>Uds</th><th>Largo</th><th>Ancho</th><th>Alto</th><th>Parcial</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<p class="empty">Sin líneas todavía. ' + esc(spec.ask) + '</p>') +
        '<div class="row"><button class="btn small" data-a="chg">Cambiar partida</button><button class="btn small" data-a="addl">Añadir línea a mano</button><button class="btn small" data-a="close">Cerrar partida</button><button class="btn small" data-a="resumen">Resumen de obra</button></div></section>';
    }
    return '<div class="ctx">' + est + amb + '</div>' + mon;
  }
  /* ---- Asistente guiado: lo medido y la pantalla de trabajos ---- */
  function zonaResumen(z) {
    const f = (v) => E.fmt(v);
    if (z.ambito === 'interior') {
      const ded = (z.huecos || []).reduce((a, x) => a + (x.uds || 1) * (x.an || 0) * (x.al || 0), 0);
      return [z.area != null ? 'Suelo ' + f(z.area) + ' m²' : 'Midiendo paredes…', z.perimetro != null ? 'perímetro ' + f(z.perimetro) + ' m' : '', z.altura ? 'altura ' + f(z.altura) + ' m' : '', z.perimetro && z.altura ? 'paredes ' + f(E.round2(z.perimetro * z.altura - ded)) + ' m²' : '', (z.huecos || []).length ? (z.huecos || []).map((x) => x.uds + ' ' + (x.tipo === 'puerta' ? 'puerta' : 'ventana') + (x.uds > 1 ? 's' : '') + ' ' + f(x.an) + '×' + f(x.al)).join(', ') : ''].filter(Boolean).join(' · ');
    }
    if (z.ambito === 'fachada') return f(z.ancho) + ' × ' + f(z.alto) + ' m' + ((z.ventanas || []).length ? ' · ventanas: ' + z.ventanas.map((v) => v.uds + ' de ' + f(v.an) + '×' + f(v.al)).join(', ') : '');
    if (z.ambito === 'cubierta') return z.tipo === 'inclinada' ? 'Inclinada · ' + (z.faldones || []).map((x) => x.nombre + ' ' + f(x.l) + '×' + f(x.a)).join(', ') + (z.factor ? ' · factor ' + f(z.factor) : '') : 'Plana' + (z.area != null ? ' · ' + f(z.area) + ' m² · perímetro ' + f(z.perimetro) + ' m' : '') + (z.remonte ? ' · remonte ' + f(z.remonte) + ' m' : '');
    if (z.ambito === 'piscina') return [z.area != null ? f(z.area) + ' m² · perímetro ' + f(z.perimetro) + ' m' : 'Midiendo…', z.prof ? (z.pmin !== z.pmax ? 'profundidad ' + f(z.pmin) + ' a ' + f(z.pmax) + ' m' : 'profundidad ' + f(z.prof) + ' m') : ''].filter(Boolean).join(' · ');
    if (z.ambito === 'fontaneria') { const x = z.f || {}; return ['AF ' + (x.af ?? '–'), 'AF+AC ' + (x.afc ?? '–'), x.inodoro ? 'inodoro ' + x.inodoro : '', x.ducha ? (x.ducha === 'banera' ? 'bañera' : 'plato de ducha') + (x.mampara ? ' con mampara' : '') : '', x.bide ? 'bidé' : '', x.lavadora ? 'lavadora' : '', x.lavavajillas ? 'lavavajillas' : ''].filter(Boolean).join(' · '); }
    if (z.ambito === 'electricidad') { const x = z.e || {}; return ['luz ' + (x.luz ?? '–'), 'tomas ' + (x.tomas ?? '–'), x.c3 ? 'cocina/horno 25 A' : '', x.c4 && x.c4.length ? x.c4.join(', ') : '', x.norma ? 'según REBT' : ''].filter(Boolean).join(' · '); }
    return '';
  }
  function viewToma(o) {
    const zs = (o.toma && o.toma.zonas) || [];
    const AL = window.Guia ? Guia.AMBITO_LABEL : {};
    let h = '<section class="monitor"><div class="mon-head"><div class="left"><div class="code">TOMA DE DATOS</div><div class="resumen">' + (zs.length ? 'Lo medido hasta ahora' : 'Medición guiada') + '</div></div></div>';
    if (!zs.length) h += '<p class="empty">Responde a las preguntas del asistente. Primero tomamos las medidas y después eliges en la pantalla los trabajos que se van a hacer.</p>';
    const grupos = {};
    zs.forEach((z) => { (grupos[z.ambito] = grupos[z.ambito] || []).push(z); });
    Object.keys(grupos).forEach((k) => {
      h += '<div class="chap"><span></span><span>' + esc(AL[k] || k) + '</span></div><div class="plist">';
      grupos[k].forEach((z) => { h += '<div class="pitem toma-z"><span class="r">' + esc(z.nombre) + '<small>' + esc(zonaResumen(z)) + '</small></span>' + (z.planta && z.planta.pts ? '<span class="mini">' + E.plantaSVG(z.planta) + '</span>' : '<span></span>') + '<span class="zbtns"><button class="iconbtn zdel" data-a="zedit" data-z="' + z.id + '" aria-label="Editar ' + esc(z.nombre) + '">' + ICON.edit + '</button><button class="iconbtn zdel" data-a="zdel" data-z="' + z.id + '" aria-label="Eliminar ' + esc(z.nombre) + '">' + ICON.del + '</button></span></div>'; });
      h += '</div>';
    });
    const ps = o.partidas.filter((x) => x.lineas.length);
    if (ps.length) {
      h += '<div class="chap"><span></span><span>Estado de mediciones</span></div><div class="plist">';
      ps.slice().sort((x, y) => (x.codigo || '').localeCompare(y.codigo || '')).forEach((p) => { h += '<button class="pitem" data-a="goto" data-uid="' + p.uid + '"><span class="c">' + esc(p.codigo || '') + '</span><span class="r">' + esc(p.r) + '<small>' + esc(p.ref) + ' · ' + p.lineas.length + ' líneas</small></span><span class="t num">' + E.fmt(E.totalOf(p)) + ' ' + unitL(p.u) + '</span></button>'; });
      h += '</div>';
    }
    if (zs.length) h += '<div class="row"><button class="btn primary" data-a="trabajos">' + (ps.length ? 'Cambiar trabajos' : 'Elegir trabajos') + '</button>' + (ps.length ? '<button class="btn" data-a="resumen">Resumen y exportar</button>' : '') + '<button class="btn" data-a="guiada">Medir otra zona</button></div>';
    return h + '</section>';
  }
  function viewTrabajos() {
    const o = S.obra, G = window.Guia;
    const cat = catFor(o);
    const sel = G.seleccion(o);
    const ws = G.trabajosPara(o);
    const zs = (o.toma && o.toma.zonas) || [];
    let h = '<p class="hint">Marca los trabajos que se van a hacer. Las cantidades salen de lo que has medido; en cada trabajo puedes elegir a qué zonas se aplica.</p>';
    const amb = [...new Set(ws.map((w) => w.ambito))];
    amb.forEach((a) => {
      if (amb.length > 1) h += '<h3 class="sec-title">' + esc(G.AMBITO_LABEL[a] || a) + '</h3>';
      const caps = [...new Set(ws.filter((w) => w.ambito === a).map((w) => w.capitulo))].sort((x, y) => G.CAP_ORDEN.indexOf(x) - G.CAP_ORDEN.indexOf(y));
      caps.forEach((c) => {
        h += '<div class="chap"><span></span><span>' + esc(c) + '</span></div><div class="tw-list">';
        ws.filter((w) => w.ambito === a && w.capitulo === c).forEach((w) => {
          const s = sel[w.id] || { on: false, zonas: [] };
          const zw = G.zonasDe(o, w);
          const d = G.resolverDoc(cat, w);
          h += '<div class="tw' + (s.on ? ' on' : '') + '"><button class="tw-main" data-a="tw" data-id="' + esc(w.id) + '" aria-pressed="' + !!s.on + '"><span class="tw-box">' + (s.on ? '✓' : '') + '</span><span class="tw-t">' + esc(w.label) + ' <span class="u">' + unitL(w.u) + '</span><small>' + esc(w.regla.startsWith('fon') || w.regla.startsWith('san') || w.regla.startsWith('ele') ? 'Según lo respondido' : (G.REGLA_LABEL[w.regla] || '')) + (d ? ' · ' + esc(d.c) : '') + '</small></span></button>';
          if (s.on && zw.length > 1) h += '<div class="tw-z">' + zw.map((z) => '<button class="chip' + (s.zonas.includes(z.id) ? ' primary' : ' ghost') + '" data-a="tz" data-id="' + esc(w.id) + '" data-z="' + z.id + '">' + esc(z.nombre) + '</button>').join('') + '</div>';
          if (s.on && w.id.startsWith('x_')) h += '<div class="tw-z"><select data-a="trule" data-id="' + esc(w.id) + '" aria-label="Cómo se mide">' + (G.REGLAS_AMBITO[w.ambito] || []).map((r) => '<option value="' + r + '"' + (r === w.regla ? ' selected' : '') + '>' + esc(G.REGLA_LABEL[r] || r) + '</option>').join('') + '</select></div>';
          h += '</div>';
        });
        h += '</div>';
      });
    });
    // Añadir partidas de la base de datos
    const ambs = [...new Set(zs.map((z) => z.ambito))];
    h += '<div class="card"><h3>Añadir otra partida de la base de datos</h3><div class="field"><input id="tq" type="search" placeholder="Ej.: impermeabilización, zócalo, barandilla…" value="' + esc(S.tq || '') + '" aria-label="Buscar partida"></div>' +
      (ambs.length > 1 ? '<div class="chips">' + ambs.map((a) => '<button class="chip' + ((S.tamb || ambs[0]) === a ? ' primary' : ' ghost') + '" data-a="tamb" data-v="' + a + '">' + esc(G.AMBITO_LABEL[a]) + '</button>').join('') + '</div>' : '') +
      '<div class="searchres" id="tres">' + tResults() + '</div>' +
      '<h3 style="margin-top:14px">Crear una partida nueva</h3><p class="hint">Para trabajos que no están en la base: «mover estatua de sitio», «armario empotrado»… Te preguntaré la medición al generar.</p>' +
      '<div class="field"><input id="tnd" type="text" placeholder="Descripción del trabajo" aria-label="Descripción de la partida nueva"></div>' +
      '<div class="row"><select id="tnu" aria-label="Unidad"><option value="ud">Unidades</option><option value="m">Metros</option><option value="m2">m²</option><option value="m3">m³</option></select>' +
      (zs.length > 1 ? '<select id="tnz" aria-label="Dónde"><option value="">En todas las zonas</option>' + zs.filter((z) => z.ambito === (S.tamb || zs[0].ambito)).map((z) => '<option value="' + z.id + '">' + esc(z.nombre) + '</option>').join('') + '</select>' : '') +
      '<button class="btn" data-a="tnew">Crear partida</button></div></div>';
    h += '<div class="tw-bar"><button class="btn primary big" data-a="tgen">Generar mediciones</button><button class="btn" data-a="tmedir">Medir algo más</button></div>';
    return h;
  }
  function tResults() {
    const q = S.tq || ''; if (q.trim().length < 3) return '';
    const r = catFor(S.obra).index.search(q).slice(0, 12);
    if (!r.length) return '<p class="hint">Sin resultados: créala abajo como partida nueva.</p>';
    return r.map((x) => '<div class="pitem"><span class="c">' + esc(x.doc.c) + '</span><span class="r">' + esc(x.doc.r) + '<small>' + unitL(x.doc.u) + ' · ' + esc(x.doc.path) + '</small></span><button class="btn small" data-a="tadd" data-code="' + esc(x.doc.c) + '">Añadir</button></div>').join('');
  }
  function renderTalk() {
    const el = $('#talk'); if (!el) return;
    const last = S.log.slice(-4);
    el.innerHTML = last.map((m, i) => '<div class="bub ' + m.who + (m.svg ? ' sketch' : '') + (i < last.length - 2 && !m.svg ? ' old' : '') + '">' + (m.svg ? '<div class="sketch-t">' + esc(m.text) + '</div>' + m.svg : esc(m.text)) + '</div>').join('') +
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
    const sb = $('#startbar'); if (sb) { sb.hidden = !!S.session || !vozVista(); const bt = $('#btnStartTxt'); if (bt) bt.textContent = S.ended ? 'Seguir midiendo' : 'Empezar a medir'; }
    $('#btnHands').setAttribute('aria-pressed', S.settings.hands);
    $('#dock').classList.toggle('min', !!S.settings.dockMin);
    const bd = $('#btnDock'); if (bd) { bd.setAttribute('aria-pressed', !!S.settings.dockMin); bd.setAttribute('aria-label', S.settings.dockMin ? 'Mostrar conversación' : 'Ocultar conversación'); bd.querySelector('.t').textContent = S.settings.dockMin ? 'Mostrar' : 'Ocultar'; }
    $('#btnKeyboard').setAttribute('aria-pressed', S.typing);
    $('#typebar').hidden = !S.typing;
  }

  function viewObras() {
    const uid = window.Cloud && Cloud.user ? Cloud.user.id : null;
    const list = S.obras.filter((o) => o.ejemplo || !o.owner || o.owner === uid).slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const canNew = BillingGuard.canCreateObra(list.filter((o) => !o.ejemplo).length);
    const plan = S.serverPlan === 'admin' ? '<span class="badge pro">Administrador · sin límites</span>' : BillingGuard.plan === 'pro' ? '<span class="badge pro">Plan Pro</span>' : '<span class="badge">Plan Demo · hasta ' + BillingGuard.MAX_DEMO + ' obras · PDF con marca de agua</span>';
    let h = '';
    if (window.Cloud && Cloud.available()) {
      if (!Cloud.user) h += '<div class="installcard acct"><div class="tx"><b>Crea tu cuenta</b>Guarda tus obras en la nube y activa la ayuda de la IA cuando la app no te entienda.</div><div class="row" style="flex-wrap:nowrap"><button class="btn" data-a="login">Entrar</button><button class="btn primary" data-a="signup">Crear cuenta</button></div></div>';
      else h += '<div class="syncline"><span class="dot' + (navigator.onLine === false ? ' off' : '') + '"></span>' + (navigator.onLine === false ? 'Sin conexión: tus obras se guardan aquí y se subirán al volver la red' : 'Obras guardadas en la nube · ' + esc((Cloud.perfil && (Cloud.perfil.empresa || Cloud.perfil.nombre)) || Cloud.user.email)) + ' <button class="linkbtn" data-a="account">Mi cuenta</button></div>';
    }
    if (canOfferInstall()) h += '<div class="installcard"><img src="' + ($('#brandlogo') ? $('#brandlogo').src : '') + '" alt=""><div class="tx"><b>Instalar en este móvil</b>Úsala como una app, desde un icono y a pantalla completa.</div><button class="btn primary" data-a="install">Instalar</button></div>';
    if (!S.settings.manualVisto) h += '<button class="installcard mfirst" data-a="manual"><span class="mi">?</span><span class="tx"><b>¿Primera vez?</b>Mira en 1 minuto cómo se usa Mediciona.</span></button>';
    h += '<div class="row" style="justify-content:space-between">' + plan + '<button class="btn primary" data-a="newobra"' + (canNew ? '' : ' disabled') + '>Nueva obra</button></div>';
    if (!canNew) h += '<p class="hint">Has llegado al límite del plan Demo. Borra una obra o activa el plan Pro en Ajustes.</p>';
    if (!list.length) h += '<div class="card"><h3>Sin obras todavía</h3><p class="hint">Crea una obra, elige el ámbito de la visita y dicta las partidas y medidas mientras recorres la obra.</p></div>';
    list.forEach((o) => {
      const np = o.partidas.filter((p) => p.lineas.length).length, nl = o.partidas.reduce((a, p) => a + p.lineas.length, 0);
      h += '<div class="card"><div class="row" style="justify-content:space-between"><h3>' + esc(o.titulo) + '</h3>' + (o.ejemplo ? '<span class="badge ex">Ejemplo</span>' : o.unlocked ? '<span class="badge pro">Desbloqueada</span>' : '') + '</div>' +
        '<div class="meta">' + esc([o.cliente, o.ubicacion].filter(Boolean).join(' · ')) + (o.cliente || o.ubicacion ? ' · ' : '') + (o.ambito ? esc(E.AMBITOS[o.ambito].label) + ' · ' : '') + np + ' partidas · ' + nl + ' líneas · ' + new Date(o.updated || o.created).toLocaleDateString('es-ES') + '</div>' +
        '<div class="row"><button class="btn primary" data-a="open" data-id="' + o.id + '">Abrir</button><button class="btn" data-a="pdf" data-id="' + o.id + '">PDF</button><button class="btn" data-a="xlsx" data-id="' + o.id + '">Excel</button><button class="btn" data-a="bc3" data-id="' + o.id + '">BC3</button><button class="btn" data-a="share" data-id="' + o.id + '">Compartir</button><button class="btn" data-a="sendmail" data-id="' + o.id + '">Enviar al correo</button><button class="btn danger" data-a="delobra" data-id="' + o.id + '">Borrar</button></div></div>';
    });
    h += '<p class="hint">Tus obras se guardan en este dispositivo. La búsqueda de partidas, el diálogo y el cálculo funcionan sin conexión.</p>';
    h += '<button class="btn" data-a="sugerencias">Buzón de sugerencias</button>';
    h += '<p class="hint legal-links"><a href="legal/aviso-legal.html">Aviso legal</a> · <a href="legal/privacidad.html">Privacidad</a> · <a href="legal/cookies.html">Cookies</a></p>';
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
    h += '<div class="row"><button class="btn primary" data-a="pdf" data-id="' + o.id + '">Exportar PDF</button><button class="btn" data-a="xlsx" data-id="' + o.id + '">Exportar Excel</button><button class="btn" data-a="bc3" data-id="' + o.id + '">Exportar BC3</button><button class="btn primary" data-a="share" data-id="' + o.id + '">Compartir</button><button class="btn" data-a="sendmail" data-id="' + o.id + '">Enviar al correo</button><button class="btn" data-a="back2obra">Volver a medir</button></div>';
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
  function viewEmpresa() {
    const e = empresaDatos(); const cuenta = !!(window.Cloud && Cloud.user);
    return '<div class="card"><h3>Empresa en los documentos</h3><div class="meta">El logo y los datos de la empresa aparecen en la cabecera del PDF de mediciones.</div>' +
      '<div class="logo-box">' + (e.logo ? '<img src="' + e.logo + '" alt="Logo de la empresa">' : '<span class="hint">Sin logo</span>') + '</div>' +
      '<div class="row"><label class="btn" for="logofile">' + (e.logo ? 'Cambiar logo' : 'Subir logo') + '</label><input id="logofile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>' + (e.logo ? '<button class="btn danger" data-a="logodel" type="button">Quitar logo</button>' : '') + '</div>' +
      (cuenta ? '<p class="hint">' + esc([e.nombre, e.nif, e.direccion, e.telefono].filter(Boolean).join(' · ') || 'Completa los datos de tu empresa.') + '</p><div class="row"><button class="btn small" data-a="account" type="button">Editar datos de la empresa</button></div>'
        : '<form id="femp" style="display:flex;flex-direction:column;gap:8px"><div class="field"><label for="enom">Empresa</label><input id="enom" value="' + esc(e.nombre) + '"></div><div class="field"><label for="enif">NIF / CIF</label><input id="enif" value="' + esc(e.nif) + '"></div><div class="field"><label for="edir">Dirección</label><input id="edir" value="' + esc(e.direccion) + '"></div><div class="field"><label for="etel">Teléfono</label><input id="etel" type="tel" value="' + esc(e.telefono) + '"></div><div class="row"><button class="btn small" type="submit">Guardar en este dispositivo</button></div></form>') + '</div>';
  }
  function viewAjustes() {
    const vs = VoiceAdapter.voices();
    const planCard = (window.Cloud && Cloud.user)
      ? '<div class="card"><h3>Plan</h3><div class="meta">' + (S.serverPlan === 'admin' ? 'Administrador: uso ilimitado y sin pagos.' : S.serverPlan === 'pro' ? 'Plan Pro: mediciones ilimitadas.' : 'Plan gratuito: la primera medición es gratis; después, pago por medición o suscripción.') + '</div></div>'
      : '<div class="card"><h3>Plan</h3><div class="meta">Demo: hasta ' + BillingGuard.MAX_DEMO + ' obras y PDF con marca de agua. Pago por obra: desbloquea la exportación limpia de una obra. Pro: obras ilimitadas.</div>' +
      '<div class="row"><button class="btn' + (S.settings.plan === 'demo' ? ' primary' : '') + '" data-a="plan" data-p="demo">Demo</button><button class="btn' + (S.settings.plan === 'pro' ? ' primary' : '') + '" data-a="plan" data-p="pro">Pro (simulado)</button></div>' +
      (S.obra ? '<div class="row"><button class="btn" data-a="unlock"' + (S.obra.unlocked ? ' disabled' : '') + '>' + (S.obra.unlocked ? 'Obra actual desbloqueada' : 'Desbloquear obra actual (simulado)') + '</button></div>' : '') + '</div>';
    return planCard +
      '<div class="card"><h3>Voz</h3><div class="meta">Reconocimiento: ' + ({ native: 'del navegador (es-ES)', claude: 'dictado de Claude', none: 'no disponible, usa el teclado' }[VoiceAdapter.mode]) + '.</div>' +
      '<label class="row" style="gap:10px"><input type="checkbox" id="chkvozn"' + (S.settings.vozNatural !== false ? ' checked' : '') + '> Voz natural (más humana; necesita cuenta y conexión, si tarda usa la del móvil)</label>' +
      '<div class="field"><label for="selvozn">Voz natural</label><select id="selvozn">' + [['Kore', 'Mujer, firme'], ['Aoede', 'Mujer, ligera'], ['Leda', 'Mujer, juvenil'], ['Zephyr', 'Mujer, clara'], ['Puck', 'Hombre, animado'], ['Charon', 'Hombre, informativo'], ['Fenrir', 'Hombre, enérgico'], ['Orus', 'Hombre, firme']].map(([v, l]) => '<option value="' + v + '"' + ((S.settings.vozNombre || 'Kore') === v ? ' selected' : '') + '>' + l + ' (' + v + ')</option>').join('') + '</select></div>' +
      (vs.length ? '<div class="field"><label for="selvoice">Voz del móvil (sin conexión)</label><select id="selvoice">' + vs.map((v) => '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === VoiceAdapter.voiceURI ? ' selected' : '') + '>' + esc(v.name + ' (' + v.lang + ')') + '</option>').join('') + '</select></div>' +
        '<div class="row"><button class="btn small" data-a="testvoice" type="button">Probar la voz</button></div>' +
        '<details class="hint"><summary>¿Suena robótica? Instala una voz mejor (gratis)</summary>' +
        '<p><b>Android:</b> Ajustes → Accesibilidad → Salida de texto a voz → Motor preferido: «Servicios de voz de Google» → icono de ajustes → Instalar datos de voz → Español (España) → elige una voz y descárgala. Después reinicia el navegador.</p>' +
        '<p><b>iPhone / iPad:</b> Ajustes → Accesibilidad → Contenido leído → Voces → Español (España) → descarga una voz «Mejorada» o «Premium» (por ejemplo Mónica o Jorge). Después cierra y vuelve a abrir Mediciona.</p>' +
        '<p><b>Ordenador:</b> en Microsoft Edge aparecen voces «Natural» (Elvira, Álvaro) muy humanas; en Chrome, «Google español».</p>' +
        '<p>Mediciona elige sola la mejor voz que tenga el dispositivo; también puedes escogerla arriba.</p></details>' : '') +
      '<label class="row" style="gap:10px"><input type="checkbox" id="chkia"' + (S.settings.ia !== false ? ' checked' : '') + '> Usar la IA cuando la app no entienda algo (necesita cuenta y conexión)</label>' +
      '<label class="row" style="gap:10px"><input type="checkbox" id="chkauri"' + (auriculares() ? ' checked' : '') + '> Uso con auriculares o manos libres Bluetooth' + (S.btDetectado && S.settings.auriculares == null ? ' (detectados)' : '') + '</label>' +
      '<p class="hint">Con auriculares la app espera un instante a que el móvil cambie el audio antes de escuchar, y no filtra el eco. Si tus auriculares no tienen micrófono, habla al del móvil.</p>' +
      '<label class="row" style="gap:10px"><input type="checkbox" id="chktono"' + (S.settings.tono !== false ? ' checked' : '') + '> Preguntas con entonación y pitido al terminar (te toca hablar)</label>' +
      '<label class="row" style="gap:10px"><input type="checkbox" id="chkbreve"' + (S.settings.breve ? ' checked' : '') + '> Modo breve: preguntas cortas, sin ejemplos ni explicaciones</label>' +
      '<p class="hint">Recomendado cuando ya conoces la app: habla menos y el micro se abre antes. También por voz: «modo breve» o «modo completo».</p>' +
      '<label class="row" style="gap:10px"><input type="checkbox" id="chkconfirm"' + (S.settings.confirm !== false ? ' checked' : '') + '> Confirmar la partida antes de medir («¿Es X?»)</label>' +
      '<div class="field"><label for="rate">Velocidad de lectura: ' + S.settings.rate.toFixed(2) + '</label><input id="rate" type="range" min="0.7" max="1.6" step="0.05" value="' + S.settings.rate + '"></div></div>' +
      viewEmpresa() +
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
  let toastAction = null;
  function toast(msg, undo, action) {
    const t = $('#toast');
    toastAction = action || null;
    t.innerHTML = esc(msg) + (undo ? '<button data-a="undo">Deshacer</button>' : '') + (action ? '<button data-a="toastact">' + esc(action.label) + '</button>' : '');
    t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 9000 : 4000);
  }
  /* ---- Archivo generado: se descarga y, si el móvil lo permite, se ofrece compartir (correo, WhatsApp…) ---- */
  function canShareFile(file) { try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); } catch (e) { return false; } }
  async function fileReady(name, blob, label) {
    const movil = isIOS() || isStandalone() || /Android/i.test(navigator.userAgent);
    if (movil && !/\.pdf$/i.test(name) && !(window.claude && window.claude.use)) {
      const tipos = [blob.type, /\.bc3$/i.test(name) ? 'text/plain' : null, 'application/octet-stream'].filter(Boolean);
      for (const t of tipos) {
        const f = new File([blob], name, { type: t });
        if (canShareFile(f)) {
          try { await navigator.share({ files: [f], title: name }); toast(label + ' listo: ' + name); return; }
          catch (e) { if (e && e.name === 'AbortError') return; break; }
        }
      }
    }
    const ok = await saveFile(name, blob);
    if (!ok) return;
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (canShareFile(file)) toast(label + ' generado', false, { label: 'Compartir', fn: () => navigator.share({ files: [file], title: name, text: 'Mediciones · ' + name }).catch(() => {}) });
    else toast(label + ' generado: ' + name);
  }
  /* ---- Instalación como app (PWA) ---- */
  const isStandalone = () => { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; } };
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; if (S.view === 'obras') render(); });
  window.addEventListener('appinstalled', () => { S.installEvt = null; toast('Mediciona instalada. Ábrela desde el icono de tu pantalla de inicio.'); render(); });
  function canOfferInstall() { return !isStandalone() && (!!S.installEvt || isIOS()); }
  async function doInstall() {
    if (S.installEvt) { const e = S.installEvt; S.installEvt = null; e.prompt(); try { await e.userChoice; } catch (er) {} render(); return; }
    if (isIOS()) return iosGuide();
    toast('Abre esta web en Chrome (Android) o Safari (iPhone) para instalarla.');
  }
  function iosGuide() {
    if ($('.ios-guide')) return;
    const notSafari = /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    const d = document.createElement('div'); d.className = 'ios-guide'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Instalar en iPhone');
    d.innerHTML = '<b class="brandtitle">Instala Mediciona en tu iPhone</b><ol>' +
      '<li>Pulsa <span class="share"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11v9h12v-9"/></svg></span> <b>Compartir</b> en la barra de abajo' + (notSafari ? ' (o arriba, junto a la dirección)' : '') + '.</li>' +
      '<li>Elige <b>«Añadir a pantalla de inicio»</b> (desliza hacia abajo si no lo ves).</li>' +
      '<li>Pulsa <b>Añadir</b>. Abre Mediciona siempre desde ese icono.</li></ol>' +
      (notSafari ? '<p class="hint">Si no aparece la opción, abre mediciona.es en Safari.</p>' : '') +
      '<div class="row" style="justify-content:space-between"><button class="btn" data-a="iosclose">Ahora no</button><svg class="arrow" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 4v15M6 13l6 6 6-6"/></svg></div>';
    document.body.appendChild(d);
  }
  function menuSheet() {
    const items = [['obras', ICON.obras, 'Mis obras']];
    if (S.obra) items.push(['menu-obra', ICON.pin, 'Medir: ' + S.obra.titulo], ['resumen', ICON.list, 'Resumen de la obra'], ['pdf', ICON.pdf, 'Exportar PDF de mediciones'], ['xlsx', ICON.list, 'Exportar Excel (.xlsx)'], ['bc3', ICON.book, 'Exportar BC3 (Presto / Arquímedes)'], ['share', ICON.pdf, 'Compartir archivos (PDF, Excel, BC3)'], ['sendmail', ICON.pdf, 'Enviar archivos a mi correo'], ['undo', ICON.undo, 'Deshacer último cambio'], ['exportlog', ICON.list, 'Descargar registro de la conversación']);
    if (canOfferInstall()) items.push(['install', ICON.obras, 'Instalar en este móvil']);
    if (window.Cloud && Cloud.available()) items.push(['account', ICON.gear, Cloud.user ? 'Mi cuenta' : 'Entrar o crear cuenta']);
    if (window.Cloud && Cloud.user) items.push(['logout', ICON.undo, 'Cerrar sesión (' + Cloud.user.email + ')']);
    if (window.Cloud && Cloud.isAdmin) items.push(['admin', ICON.list, 'Administración' + (S.sgNew ? ' · ' + S.sgNew + (S.sgNew === 1 ? ' sugerencia nueva' : ' sugerencias nuevas') : '')]);
    items.push(['sugerencias', ICON.help, 'Buzón de sugerencias']);
    items.push(['catalogos', ICON.book, 'Bases de datos BC3'], ['ajustes', ICON.gear, 'Ajustes y plan'], ['ayuda', ICON.help, 'Cómo se usa (ayuda)']);
    sheet('<h2>Menú</h2><div class="menu-list">' + items.map(([a, i, l]) => '<button data-a="' + a + '"' + (a === 'pdf' || a === 'xlsx' || a === 'bc3' || a === 'sendmail' || a === 'share' ? ' data-id="' + (S.obra ? S.obra.id : '') + '"' : '') + '>' + i + esc(l) + '</button>').join('') + '</div>');
  }
  /* ---- Guía de uso ---- */
  function viewManual() {
    const ic = (sel, cls) => { const el = $(sel); const sv = el && el.querySelector('svg'); return '<span class="mi' + (cls ? ' ' + cls : '') + '">' + (sv ? sv.outerHTML : '') + '</span>'; };
    const btn = (sel, txt, cls) => '<div class="mrow">' + ic(sel, cls) + '<div>' + txt + '</div></div>';
    const chip = (t) => '<span class="mchip">' + t + '</span>';
    const say = (t) => '<span class="msay">«' + t + '»</span>';
    const sec = (id, tit, body, open) => '<details class="card msec" id="m_' + id + '"' + (open ? ' open' : '') + '><summary>' + tit + '</summary><div class="mbody">' + body + '</div></details>';
    let h = '<p class="mlead">Mediciona mide la obra <b>hablando</b>. Tú dices las medidas en voz alta y la app las apunta, calcula y prepara el estado de mediciones en PDF, Excel o BC3.</p>';
    h += sec('pasos', '1. Empezar en 4 pasos', '<ol class="msteps">' +
      '<li>En <b>Mis obras</b>, pulsa <b>Nueva obra</b> y ponle un nombre.</li>' +
      '<li>Pulsa <b>Empezar a medir</b>. La primera vez el móvil te pedirá permiso para el micrófono: dale a <b>Permitir</b>.</li>' +
      '<li><b>La app te pregunta paso a paso</b> (medidas, altura, puertas y ventanas, qué hay que hacer…) y tú <b>contestas con tus palabras</b>. Puedes decir más de lo que te pregunta o adelantar cosas: ' + say('dos sesenta, y por cierto la cocina mide tres por dos cuarenta') + '. Lo guarda todo y no te vuelve a preguntar lo que ya sabe.</li>' +
      '<li>Cuando acabes, di ' + say('genera las mediciones') + '. Te preguntará lo que falte y tendrás el estado de mediciones listo para exportar.</li></ol>' +
      '<p class="mtip">Para corregir: ' + say('atrás') + ' o ' + say('no, eran dos cincuenta') + '. Para saltar una pregunta: ' + say('saltar') + '. Si prefieres contarlo todo tú sin preguntas, di ' + say('te lo cuento yo') + '. Con la cuenta iniciada y conexión la app entiende respuestas libres; sin ella, pregunta paso a paso con respuestas más cortas.</p>' +
      '<p class="mtip">No hace falta pulsar nada mientras hablas: el micrófono se abre solo cuando la app termina de hablar.</p>', true);
    h += sec('botones', '2. Para qué sirve cada botón',
      '<h4>Arriba</h4>' +
      btn('#btnBack', '<b>Volver</b>: regresa a la pantalla anterior o a tus obras.') +
      btn('#btnHelp', '<b>Ayuda</b>: abre esta guía.') +
      btn('#btnSol', '<b>Modo sol</b>: más contraste para ver bien la pantalla al aire libre.') +
      btn('#btnMenu', '<b>Menú</b>: tus obras, resumen, exportar (PDF, Excel, BC3), compartir, enviar al correo, bases de precios, ajustes y tu cuenta.') +
      '<h4>Abajo, mientras mides</h4>' +
      btn('#btnMic', '<b>Micrófono</b>: cuando se mueven las ondas, la app te está escuchando. Púlsalo si quieres hablar tú primero o si se ha cerrado.', 'big') +
      btn('[data-a="stop"]', '<b>Parar</b>: corta la voz de la app y deja de escuchar. Úsalo para hacer una pausa.', 'stop') +
      btn('#btnKeyboard', '<b>Teclado</b>: escribe en lugar de hablar (útil si hay mucho ruido). Escribe lo mismo que dirías.') +
      btn('#btnDock', '<b>Ocultar / mostrar conversación</b>: deja más espacio para ver las mediciones. Púlsalo otra vez para recuperarla.') +
      btn('#btnHands', '<b>Manos libres</b> (el icono de ondas, a la derecha del micrófono): encendido, en color, el micrófono se vuelve a abrir solo cada vez que la app termina de hablar. Apagado, tienes que pulsar el micrófono para contestar. Viene encendido.', 'on') +
      '<div class="mrow"><span class="mi">' + chip('Sí') + '</span><div><b>Botones de respuesta</b>: aparecen debajo de cada pregunta. Si no quieres hablar, pulsa la respuesta.</div></div>' +
      '<div class="mrow"><span class="mi">' + chip('↩ Atrás') + '</span><div><b>Atrás</b>: deshace lo último que has dicho. Úsalo si te has equivocado.</div></div>' +
      '<h4>En la pantalla de la obra</h4>' +
      '<div class="mrow"><span class="mi">' + ICON.pin + '</span><div><b>Estancia</b>: indica dónde estás midiendo (salón, baño…). Púlsalo para cambiar de estancia.</div></div>' +
      '<div class="mrow"><span class="mi">' + ICON.edit + '</span><div><b>Editar línea</b>: cambia a mano una medida.</div></div>' +
      '<div class="mrow"><span class="mi">' + ICON.del + '</span><div><b>Borrar</b>: quita una línea o una estancia.</div></div>' +
      '<h4>En la pantalla de trabajos</h4>' +
      '<p>Cada trabajo tiene una casilla: <b>márcala</b> si lo vas a hacer. Debajo eliges en qué estancias. Con <b>Añadir</b> buscas cualquier partida de la base, y con <b>Crear partida</b> haces una nueva. Al acabar, <b>Generar mediciones</b>.</p>');
    h += sec('decir', '3. Qué puedo decir',
      '<table class="mtab"><tbody>' +
      [['Contar la obra (modo conversación)', 'en la cocina, que es de tres por dos cuarenta, hay que alicatar y cambiar el suelo · en el baño, plato de ducha con mampara e inodoro suspendido · toda la casa hay que pintarla · en el pasillo hay un pilar con los hierros oxidados, un metro veinte'],
        ['Corregir', 'no, el salón era de cuatro veinte · deshaz eso · la pintura del baño no se hace'],
        ['Acabar', 'genera las mediciones'],
        ['Qué medimos', 'vivienda · estancia · instalaciones · fachada · cubierta · piscina · otra cosa'],
        ['Una habitación rectangular', '4 por 3 · cuatro con veinte por tres'],
        ['Una habitación con otra forma', '4 metros, giro a la derecha, 3 metros, derecha · cierra'],
        ['La altura', 'dos sesenta · 2,60'],
        ['Puertas y ventanas', 'una puerta de 0,82 por 2,03 y dos ventanas de 1,20 por 1,10 · ninguna'],
        ['Algo que ves y hay que arreglar', 'este pilar tiene los hierros oxidados · hay humedad en el muro · hay grietas'],
        ['Una partida que no está', 'añade mover la estatua del jardín'],
        ['Cambiar de sitio', 'pasamos al baño · borra el pasillo'],
        ['Terminar', 'elegir trabajos · generar mediciones · finalizar'],
        ['Exportar', 'exporta el PDF · comparte los archivos'],
        ['Si te pierdes', 'ayuda · repite · atrás · saltar']].map(([a, b]) => '<tr><th>' + a + '</th><td>' + b.split(' · ').map(say).join(' ') + '</td></tr>').join('') +
      '</tbody></table><p class="mtip">Habla con normalidad. Si la app no entiende algo, te lo vuelve a preguntar o lo consulta con la IA (con la cuenta iniciada y conexión).</p>');
    h += sec('errores', '4. Si me equivoco', '<ul class="mlist">' +
      '<li>Di ' + say('atrás') + ' o ' + say('me he equivocado') + ', o pulsa ' + chip('↩ Atrás') + '. Se borra lo último.</li>' +
      '<li>Corrige en la misma frase: ' + say('2,60, no, perdón, 2,70') + '. La app te preguntará cuál es la buena.</li>' +
      '<li>Corrige algo de antes: ' + say('las ventanas de antes son puertas') + ' o ' + say('la altura era 2,50') + '.</li>' +
      '<li>En el estado de mediciones puedes tocar ' + ICON.edit + ' para cambiar cualquier número a mano.</li></ul>');
    h += sec('exportar', '5. Sacar el PDF, Excel o BC3', '<ul class="mlist">' +
      '<li>Abre el ' + ic('#btnMenu') + ' <b>Menú</b> y elige <b>Exportar PDF</b>, <b>Excel</b> o <b>BC3</b> (para Presto o Arquímedes).</li>' +
      '<li>En el móvil, <b>Compartir archivos</b> te deja enviarlos por WhatsApp, correo, Drive…</li>' +
      '<li>El logo y los datos de tu empresa salen en el PDF: ponlos en <b>Ajustes</b>.</li></ul>');
    h += sec('manos', '6. Manos libres y auriculares', '<ul class="mlist">' +
      '<li>Puedes medir con el móvil en el bolsillo: la app pregunta, tú contestas, y vuelve a escuchar sola. Para eso, el botón ' + ic('#btnHands', 'on') + ' <b>Manos libres</b> tiene que estar encendido (en color).</li>' +
      '<li>Con auriculares bluetooth, comprueba que en Ajustes está marcado <b>Uso con auriculares o manos libres</b> (normalmente se detectan solos).</li>' +
      '<li><b>Cuando la app te pregunta algo</b>, sube un poco el tono y al acabar suena un <b>pitido corto</b>: es tu turno de hablar. Se puede quitar en Ajustes.</li>' +
      '<li>¿La app habla demasiado? Di ' + say('modo breve') + ': las preguntas serán cortas y sin ejemplos. ' + say('modo completo') + ' lo deja como estaba.</li>' +
      '<li>Para pausar, pulsa ' + ic('[data-a="stop"]', 'stop') + ' <b>Parar</b>. Para seguir, el ' + ic('#btnMic') + ' <b>micrófono</b>.</li></ul>');
    h += sec('problemas', '7. Problemas frecuentes', '<ul class="mlist">' +
      '<li><b>No me oye:</b> comprueba que el navegador tiene permiso de micrófono y que se mueven las ondas del micrófono. En iPhone usa Safari; en Android, Chrome.</li>' +
      '<li><b>Me interrumpe o se oye a sí misma:</b> baja el volumen o usa auriculares.</li>' +
      '<li><b>Hay mucho ruido:</b> usa el ' + ic('#btnKeyboard') + ' teclado.</li>' +
      '<li><b>No entiende un número:</b> dilo con coma: ' + say('dos coma sesenta') + ' o ' + say('dos sesenta') + '.</li>' +
      '<li><b>¿Se guarda?</b> Sí, todo se guarda solo en el móvil y, con cuenta, en la nube.</li>' +
      '<li><b>¿Algo no funciona?</b> Escríbenos desde el Menú, en <b>Buzón de sugerencias</b>.</li></ul>');
    h += '<div class="row" style="justify-content:center;margin:16px 0 40px"><button class="btn primary" data-a="mclose">Entendido</button></div>';
    return h;
  }
  function abrirManual(sec) {
    closeSheet();
    if (S.view !== 'manual') S.prevView = S.view;
    S.view = 'manual'; S.settings.manualVisto = true; saveSettings(); render();
    window.scrollTo(0, 0);
    if (sec) { const d = $('#m_' + sec); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } }
  }
  function cerrarManual() { S.view = S.prevView && S.prevView !== 'manual' && (S.obra || !/^(obra|trabajos|resumen)$/.test(S.prevView)) ? S.prevView : 'obras'; render(); }
  function helpSheet() {
    sheet('<h2>Qué puedo decir</h2><div class="hint" style="display:flex;flex-direction:column;gap:6px">' +
      ['<b>Trabajo:</b> «picado de azulejos», «pintura plástica en techo», «nueva partida rozas»',
        '<b>Medidas:</b> «pared ducha 1,80 por 2,50», «tres con cuarenta por dos cincuenta», «2 de 1,20 por 1,40», «largo 4 alto 2,6»',
        '<b>Huecos:</b> «descuenta puerta de 0,82 por 2,03»',
        '<b>Salas en L o irregulares:</b> «4 por 3 y 2 por 1,5», «superficie 18,5», o el rectángulo grande y «descuenta 1,5 por 2». Si dices «no es rectangular» te lo explico',
        '<b>Estancias:</b> «pasamos al baño», «estancia dormitorio 2», «siguiente estancia»',
        '<b>Revisión:</b> «revisa la última partida», «muéstrame la demolición de alicatado», «lee las líneas», «qué llevo medido en la cocina», «resumen»',
        '<b>Corrección:</b> «borra la última línea», «borra la línea 3», «cambia el largo de la línea 2 a 3 con 40», «cambia la última línea a 3 por 2,5», «deshacer»',
        '<b>Herencia:</b> «aplica las mismas medidas que en el pavimento», «copia las paredes del salón pero descuenta las ventanas»',
        '<b>Exportar:</b> «exporta el PDF», «exporta en Excel», «genera el BC3»',
        '<b>Partida:</b> «siguiente partida», «ahora guarnecido de yeso», «pintura con las mismas medidas», «borra esta partida», «exporta el PDF»',
        '<b>Corregir partida:</b> «no es esa», «cambia la partida», «esa no, es solado de gres 60x60» (las medidas pasan a la nueva)',
        '<b>Paredes:</b> «perímetro 14,20» (o «perímetro 3,40 más 2,80…», o pared a pared) y luego la altura «2,60»',
        '<b>Terminar:</b> «terminar», «he terminado», «eso es todo»',
        '<b>Diálogo:</b> «repite», «cancela», «ayuda»'].map((x) => '<div>' + x + '</div>').join('') +
      '</div><button class="btn" data-a="closesheet">Cerrar</button>');
  }
  /** Corregir a mano una estancia o zona: medidas (como se dirían), altura y huecos. */
  function editZonaSheet(z) {
    const f = (v) => (v == null ? '' : E.fmt(v));
    const medidas = z.rect ? f(z.rect[0]) + ' por ' + f(z.rect[1]) : (z.tramos || []).length ? z.tramos.map((t) => f(t.l) + (t.giro ? ' ' + t.giro : '')).join(', ') : z.area != null ? 'superficie ' + f(z.area) + ' y perímetro ' + f(z.perimetro) : '';
    const huecos = (z.huecos || []).map((x) => (x.uds || 1) + ' ' + (x.bal ? 'balconera' : x.tipo) + (x.uds > 1 ? 's' : '') + ' de ' + f(x.an) + ' por ' + f(x.al)).join(' y ');
    const conPlanta = /^(interior|cubierta|piscina)$/.test(z.ambito);
    sheet('<h2>' + esc(z.nombre) + '</h2><form id="fzona" style="display:flex;flex-direction:column;gap:10px">' +
      '<div class="field"><label for="zn">Nombre</label><input id="zn" value="' + esc(z.nombre) + '"></div>' +
      (conPlanta ? '<div class="field"><label for="zm">Medidas (como las dirías)</label><input id="zm" value="' + esc(medidas) + '" placeholder="4 por 3 · o 2 derecha, 1 izquierda, 1 derecha…"></div>' : '') +
      (z.ambito === 'interior' ? '<div class="field"><label for="za">Altura</label><input id="za" inputmode="decimal" value="' + f(z.altura) + '"></div>' +
        '<div class="field"><label for="zh">Puertas y ventanas</label><input id="zh" value="' + esc(huecos) + '" placeholder="1 puerta de 0,80 por 2,03 y 1 ventana de 1,20 por 1,20 · o «ninguna»"></div>' : '') +
      (z.ambito === 'piscina' ? '<div class="field"><label for="zp">Profundidad (menor y mayor)</label><input id="zp" value="' + (z.prof ? f(z.pmin) + (z.pmin !== z.pmax ? ' y ' + f(z.pmax) : '') : '') + '"></div>' : '') +
      (z.ambito === 'fachada' ? '<div class="grid2"><div class="field"><label for="zfa">Ancho</label><input id="zfa" inputmode="decimal" value="' + f(z.ancho) + '"></div><div class="field"><label for="zfl">Alto</label><input id="zfl" inputmode="decimal" value="' + f(z.alto) + '"></div></div>' : '') +
      '<p class="hint">Al guardar se recalculan todas las mediciones de esta zona.</p>' +
      '<div class="row"><button class="btn primary" type="submit">Guardar</button><button class="btn" type="button" data-a="closesheet">Cancelar</button></div></form>');
    $('#fzona').addEventListener('submit', (e) => {
      e.preventDefault();
      const C = dialog.conversa, num = (id) => { const el = $('#' + id); if (!el || !el.value.trim()) return null; const v = parseFloat(el.value.replace(',', '.')); return isNaN(v) ? null : v; };
      if (C) C.snapshot(); else dialog.snapshot();
      const nom = $('#zn').value.trim(); if (nom && nom !== z.nombre) z.nombre = nom;
      const zm = $('#zm');
      if (zm && zm.value.trim() && C) {
        const w = Guia.parseWalk(zm.value);
        if (w && w.rect) C.planta(z, { largo: w.rect[0], ancho: w.rect[1], tramos: [] }, []);
        else if (w && w.tramos) C.planta(z, { tramos: w.tramos.map((t) => ({ largo: t.l, giro: t.giro, angulo: t.ang })) }, []);
        else if (w && w.directo) C.planta(z, { superficie: w.directo.area, perimetro: w.directo.perimetro, tramos: [] }, []);
        else return toast('No entiendo las medidas. Escribe «4 por 3» o las paredes con sus giros.');
      }
      const al = num('za'); if (al) z.altura = al >= 5 ? al / 100 : al;
      const zh = $('#zh');
      if (zh) { const t = zh.value.trim(); if (!t || /^(no|ninguna|ninguno|sin)/i.test(t)) z.huecos = []; else { const hs = Guia.parseHuecos(t); if (hs.length) z.huecos = hs.map((x) => ({ tipo: x.tipo, uds: x.uds || 1, an: x.an, al: x.al, bal: !!x.bal })); } z.huecosOk = true; }
      const zp = $('#zp'); if (zp && zp.value.trim()) { const v = Guia.numeros(zp.value).map((x) => (x >= 5 ? x / 100 : x)); if (v.length) { z.pmin = Math.min(...v); z.pmax = Math.max(...v); z.prof = Math.round((z.pmin + z.pmax) * 50) / 100; } }
      const fa = num('zfa'), fl = num('zfl'); if (fa) z.ancho = fa; if (fl) z.alto = fl;
      if (C && C.activo) C.regenerar(); else if (S.obra.partidas.some((p) => p.guia)) Guia.generar(S.obra, catFor(S.obra));
      saveObra(); closeSheet(); render(); toast('Guardado: ' + z.nombre);
    });
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
      if (isNew) { nl.id = dialog.nextId(p); p.lineas.push(nl); S.lastLineId = nl.id; } else { Object.assign(l, nl); if (nl.h !== null) delete l.hPend; }
      p.mod = Date.now(); saveObra(); closeSheet(); render();
    });
  }
  /** Elegir partida a mano: buscador en la base + crear partida propia. Las medidas pasan a la elegida. */
  function pickSheet() {
    const act = dialog.active();
    const q0 = (dialog.activation && dialog.activation.query) || (act ? act.r : '') || '';
    sheet('<h2>' + (act ? 'Cambiar partida' : 'Elegir partida') + '</h2>' +
      (act ? '<p class="hint">Ahora: <b>' + esc(act.r) + '</b>. Las medidas que tomaste con ella pasan a la que elijas.</p>' : '') +
      '<div class="field"><label for="pq">Buscar en la base de datos</label><input id="pq" type="search" value="' + esc(q0) + '" placeholder="Ej.: levantado de entarimado"></div>' +
      '<div class="searchres" id="pres"></div>' +
      '<div class="card"><h3>¿No está? Crear partida propia</h3><div class="field"><label for="pd">Descripción</label><input id="pd" value="' + esc(q0) + '"></div>' +
      '<div class="row" id="punits">' + ['ud', 'm', 'm2', 'm3'].map((u, i) => '<button class="btn small' + (i === 2 ? ' primary' : '') + '" data-u="' + u + '" type="button">' + E.unitLabel(u) + '</button>').join('') + '</div>' +
      '<button class="btn primary" id="pcreate" type="button">Crear y usar esta partida</button></div>' +
      '<button class="btn" data-a="closesheet">Cancelar</button>');
    let unit = 'm2';
    $('#punits').addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (!b) return; unit = b.dataset.u; [...$('#punits').children].forEach((x) => x.classList.toggle('primary', x === b)); });
    $('#pcreate').addEventListener('click', () => { const d = $('#pd').value.trim(); if (!d) return $('#pd').focus(); closeSheet(); if (!S.session && !S.ended) { VoiceAdapter.unlock(); S.session = true; } dialog.createOwn(unit, d); });
    const upd = () => {
      const q = $('#pq').value.trim();
      const r = q.length >= 3 ? catFor(S.obra).index.search(q).slice(0, 30) : [];
      $('#pres').innerHTML = r.length ? r.map((x) => '<button class="pitem" data-a="pickdoc" data-code="' + esc(x.doc.c) + '"><span class="c">' + esc(x.doc.c) + '</span><span class="r">' + esc(x.doc.r) + '<small>' + esc(x.doc.path) + '</small></span><span class="t">' + E.unitLabel(x.doc.u) + '</span></button>').join('') : '<p class="hint">Escribe al menos 3 letras.</p>';
    };
    $('#pq').addEventListener('input', upd); upd();
  }
  /* ---- Buzón de sugerencias ----
   * Ahora: abre el correo con el mensaje preparado hacia el buzón del dominio.
   * Con el servidor (Supabase) se guardará en la base de datos y se verá en el panel de administración. */
  const SUGERENCIAS_BUZON = 'sugerencias' + '@' + 'mediciona.es';
  function suggestionSheet() {
    sheet('<h2>Buzón de sugerencias</h2><p class="hint">Cuéntanos qué mejorarías, qué echas en falta o qué no ha funcionado. Lo leemos todo.</p>' +
      '<div class="row" id="sgtype">' + ['Sugerencia', 'Algo no funciona', 'Partida que falta', 'Otra cosa'].map((t, i) => '<button type="button" class="btn small' + (i === 0 ? ' primary' : '') + '" data-t="' + t + '">' + t + '</button>').join('') + '</div>' +
      '<div class="field"><label for="sgtext">Tu mensaje</label><textarea id="sgtext" rows="5" placeholder="Ej.: cuando digo «quitar gotelé» no encuentra la partida…"></textarea></div>' +
      (S.obra ? '<label class="row" style="gap:10px"><input type="checkbox" id="sglog" checked> Adjuntar lo último que dije y respondió la app (ayuda a corregir fallos)</label>' : '') +
      '<div class="row"><button class="btn primary" id="sgsend" type="button">Enviar</button><button class="btn" data-a="closesheet" type="button">Cancelar</button></div>');
    let tipo = 'Sugerencia';
    $('#sgtype').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; tipo = b.dataset.t; [...$('#sgtype').children].forEach((x) => x.classList.toggle('primary', x === b)); });
    $('#sgsend').addEventListener('click', () => {
      const msg = $('#sgtext').value.trim();
      if (!msg) return $('#sgtext').focus();
      let body = msg + '\n\n— Tipo: ' + tipo + '\n— Dispositivo: ' + navigator.userAgent.slice(0, 160);
      if ($('#sglog') && $('#sglog').checked && S.obra && S.obra.registro) body += '\n\nÚltima conversación:\n' + S.obra.registro.slice(-20).map((r) => (r.who === 'user' ? 'OÍDO: ' : 'APP: ') + r.text).join('\n');
      if (window.Cloud && Cloud.user) {
        const conv = $('#sglog') && $('#sglog').checked && S.obra && S.obra.registro ? S.obra.registro.slice(-30) : null;
        Cloud.suggestion({ tipo, mensaje: msg, conversacion: conv, dispositivo: navigator.userAgent }).then(() => { closeSheet(); toast('Sugerencia enviada. ¡Gracias!'); }).catch((e) => toast('No se pudo enviar: ' + e.message));
        return;
      }
      closeSheet();
      location.href = 'mailto:' + SUGERENCIAS_BUZON + '?subject=' + encodeURIComponent('Mediciona · ' + tipo) + '&body=' + encodeURIComponent(body.slice(0, 1800));
      toast('Abriendo tu correo para enviar la sugerencia. ¡Gracias!');
    });
    setTimeout(() => { const t = $('#sgtext'); t && t.focus(); }, 50);
  }
  /* ---- Cuenta ---- */
  /** Valida NIF, NIE o CIF españoles (letra o dígito de control). */
  function nifValido(v) {
    const s = String(v || '').toUpperCase().replace(/[\s.-]/g, '');
    const L = 'TRWAGMYFPDXBNJZSQVHLCKE';
    if (/^\d{8}[A-Z]$/.test(s)) return L[+s.slice(0, 8) % 23] === s[8];
    if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return L[+(String('XYZ'.indexOf(s[0])) + s.slice(1, 8)) % 23] === s[8];
    if (/^[ABCDEFGHJKLMNPQRSUVW]\d{7}[0-9A-J]$/.test(s)) {
      let a = 0, b = 0; for (let i = 1; i <= 7; i++) { const d = +s[i]; if (i % 2 === 0) a += d; else { const x = d * 2; b += Math.floor(x / 10) + (x % 10); } }
      const c = (10 - ((a + b) % 10)) % 10; const k = s[8];
      return k === String(c) || k === 'JABCDEFGHI'[c];
    }
    return false;
  }
  /** Datos de la empresa para los documentos: los de la cuenta y, si no hay sesión, los guardados en el dispositivo. */
  function empresaDatos() {
    const p = (window.Cloud && Cloud.user && Cloud.perfil) || {};
    const l = S.settings.empresa || {};
    return { nombre: p.empresa || l.nombre || '', nif: p.nif || l.nif || '', direccion: p.direccion || l.direccion || '', telefono: p.telefono_contacto || l.telefono || '', logo: S.settings.logo || '' };
  }
  /** Reduce la imagen del logo (máx. 480 px) para guardarla y meterla en el PDF. */
  function leerLogo(file) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, 480 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/png')); }; img.onerror = () => rej(new Error('No se puede leer la imagen')); img.src = fr.result; };
      fr.onerror = () => rej(new Error('No se puede leer el archivo')); fr.readAsDataURL(file);
    });
  }
  function accountSheet(mode) {
    const C = window.Cloud;
    if (mode === 'perfil' && C.user) {
      const p = C.perfil || {};
      sheet('<h2>Mi cuenta</h2><p class="hint">' + esc(C.user.email) + ' · Plan ' + (p.plan === 'pro' ? 'Pro' : 'gratuito') + '</p>' +
        '<form id="facc" style="display:flex;flex-direction:column;gap:10px">' +
        '<div class="field"><label for="anom">Nombre y apellidos</label><input id="anom" autocomplete="name" value="' + esc(p.nombre || '') + '"></div>' +
        '<div class="field"><label for="aemp">Empresa o razón social</label><input id="aemp" autocomplete="organization" value="' + esc(p.empresa || '') + '"></div>' +
        '<div class="field"><label for="anif">NIF / CIF</label><input id="anif" value="' + esc(p.nif || '') + '"></div>' +
        '<div class="field"><label for="adir">Dirección de la empresa</label><input id="adir" autocomplete="street-address" value="' + esc(p.direccion || '') + '"></div>' +
        '<div class="field"><label for="atel">Teléfono de contacto (aparece en los documentos)</label><input id="atel" type="tel" autocomplete="tel" value="' + esc(p.telefono_contacto || '') + '"></div>' +
        '<p class="hint">El logo de la empresa se pone en <b>Ajustes › Empresa en los documentos</b>.</p>' +
        '<p class="hint">Teléfono: ' + (p.telefono_verificado ? esc(p.telefono) + ' (verificado)' : 'pendiente de verificar por SMS (lo activaremos pronto)') + '</p>' +
        '<div class="row"><button class="btn primary" type="submit">Guardar</button><button class="btn" type="button" data-a="closesheet">Cerrar</button><button class="btn danger" type="button" data-a="logout">Cerrar sesión</button></div></form>');
      $('#facc').addEventListener('submit', async (e) => { e.preventDefault(); const nif = $('#anif').value.trim().toUpperCase(); if (nif && !nifValido(nif)) return toast('El NIF / CIF no es válido. Revísalo.'); try { await C.updateProfile({ nombre: $('#anom').value.trim(), empresa: $('#aemp').value.trim(), nif, direccion: $('#adir').value.trim(), telefono: $('#atel').value.trim() }); closeSheet(); toast('Datos guardados'); render(); } catch (er) { toast(er.message); } });
      return;
    }
    if (mode === 'newpass') {
      sheet('<h2>Nueva contraseña</h2><form id="fnp" style="display:flex;flex-direction:column;gap:10px"><div class="field"><label for="np1">Nueva contraseña (mínimo 8 caracteres)</label><input id="np1" type="password" autocomplete="new-password" minlength="8" required></div><div class="row"><button class="btn primary" type="submit">Guardar contraseña</button></div><p class="hint" id="accmsg"></p></form>');
      $('#fnp').addEventListener('submit', async (e) => { e.preventDefault(); try { await C.updatePassword($('#np1').value); closeSheet(); toast('Contraseña cambiada'); } catch (er) { $('#accmsg').textContent = er.message; } });
      return;
    }
    const signup = mode === 'signup', forgot = mode === 'forgot';
    sheet('<h2>' + (signup ? 'Crear cuenta' : forgot ? 'Recuperar contraseña' : 'Entrar') + '</h2>' +
      '<form id="facc" style="display:flex;flex-direction:column;gap:10px">' +
      (signup ? '<div class="mailnote">Al crear la cuenta te enviaremos un correo de <b>Mediciona</b> (hola@mediciona.es) con el asunto <b>«Confirma tu cuenta de Mediciona»</b>. Si no lo ves en unos minutos, mira en Spam o Promociones.</div>' : '') +
      (signup ? '<div class="field"><label for="anom">Nombre y apellidos</label><input id="anom" autocomplete="name" required></div>' +
        '<div class="field"><label for="aemp">Empresa o razón social</label><input id="aemp" autocomplete="organization" required></div>' +
        '<div class="field"><label for="anif">NIF / CIF de la empresa</label><input id="anif" required autocapitalize="characters"></div>' +
        '<div class="field"><label for="adir">Dirección de la empresa</label><input id="adir" autocomplete="street-address" required></div>' +
        '<div class="field"><label for="atel">Teléfono de contacto (opcional)</label><input id="atel" type="tel" autocomplete="tel"></div>' +
        '<div class="field hp" aria-hidden="true"><label for="aweb">No rellenar</label><input id="aweb" tabindex="-1" autocomplete="off"></div>' : '') +
      '<div class="field"><label for="amail">Correo electrónico</label><input id="amail" type="email" autocomplete="email" required></div>' +
      (forgot ? '' : '<div class="field"><label for="apass">Contraseña' + (signup ? ' (mínimo 8 caracteres)' : '') + '</label><input id="apass" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" minlength="8" required></div>') +
      (signup ? '<label class="checkline"><input type="checkbox" id="alegal" required><span>Soy profesional o empresa y acepto el <a href="legal/aviso-legal.html" target="_blank">aviso legal</a> y la <a href="legal/privacidad.html" target="_blank">política de privacidad</a>.</span></label>' : '') +
      '<div class="row"><button class="btn primary" type="submit">' + (signup ? 'Crear cuenta' : forgot ? 'Enviar enlace' : 'Entrar') + '</button><button class="btn" type="button" data-a="closesheet">Cancelar</button></div>' +
      '<p class="hint" id="accmsg" role="status"></p>' +
      '<p class="hint">' + (signup ? '¿Ya tienes cuenta? <button class="linkbtn" type="button" data-a="login">Entrar</button>' : forgot ? '<button class="linkbtn" type="button" data-a="login">Volver a entrar</button>' : '¿No tienes cuenta? <button class="linkbtn" type="button" data-a="signup">Crear cuenta</button> · <button class="linkbtn" type="button" id="aforgot">He olvidado la contraseña</button>') + '</p></form>');
    const abierto = Date.now();
    const fg = $('#aforgot'); if (fg) fg.addEventListener('click', () => accountSheet('forgot'));
    $('#facc').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#accmsg'); const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; msg.textContent = 'Un momento…';
      try {
        const email = $('#amail').value.trim();
        if (forgot) { await C.resetPassword(email); msg.textContent = 'Si existe una cuenta con ese correo, te hemos enviado un enlace para crear una contraseña nueva.'; btn.disabled = false; return; }
        if (signup) {
          // Filtros contra registros automáticos: campo trampa, tiempo mínimo y NIF/CIF con control válido
          if ($('#aweb').value || Date.now() - abierto < 4000) { msg.textContent = 'Revisa los datos y vuelve a intentarlo.'; btn.disabled = false; return; }
          const nif = $('#anif').value.trim().toUpperCase().replace(/[\s.-]/g, '');
          if (!nifValido(nif)) { msg.textContent = 'El NIF / CIF no es válido. Revísalo (letra o dígito de control).'; btn.disabled = false; return; }
          if ($('#adir').value.trim().length < 6) { msg.textContent = 'Escribe la dirección completa de la empresa.'; btn.disabled = false; return; }
          const r = await C.signUp({ email, password: $('#apass').value, nombre: $('#anom').value.trim(), empresa: $('#aemp').value.trim(), nif, direccion: $('#adir').value.trim(), telefono: $('#atel').value.trim() });
          if (r.needsConfirm) return checkEmailSheet(email);
        } else await C.signIn(email, $('#apass').value);
        closeSheet(); toast(signup ? 'Cuenta creada. ¡Bienvenido a Mediciona!' : 'Sesión iniciada');
      } catch (er) { msg.textContent = er.message; btn.disabled = false; }
    });
    setTimeout(() => { const f = $('#facc input'); f && f.focus(); }, 60);
  }
  /** Cerrar sesión: sube lo pendiente, cierra y quita del dispositivo las obras de esa cuenta (siguen en la nube). */
  async function logout(force) {
    const C = window.Cloud; if (!C || !C.user) return;
    const uid = C.user.id;
    const ok = await C.flush();
    if (!ok && !force) {
      return confirmSheet('Hay cambios que aún no se han subido a la nube (sin conexión). Si cierras sesión ahora se perderán. ¿Cerrar igualmente?', 'Cerrar sesión', () => logout(true));
    }
    sayToken++; VoiceAdapter.stopSpeaking(); VoiceAdapter.stopListening();
    await C.signOut();
    const mine = S.obras.filter((o) => o.owner === uid);
    for (const o of mine) await StorageAdapter.del('obras', o.id);
    S.obras = S.obras.filter((o) => o.owner !== uid);
    S.obra = null; S.session = false; S.ended = false; S.view = 'obras';
    applyServerPlan(); render();
    toast('Sesión cerrada' + (mine.length ? '. Tus obras siguen guardadas en la nube.' : ''));
  }
  /** El plan real lo decide el servidor (perfil); el ajuste local solo vale sin cuenta. */
  function applyServerPlan() {
    const C = window.Cloud;
    const pro = !!(C && C.user && (C.isAdmin || (C.perfil && C.perfil.plan === 'pro' && (!C.perfil.pro_hasta || new Date(C.perfil.pro_hasta) > new Date()))));
    BillingGuard.plan = pro ? 'pro' : (C && C.user ? 'demo' : S.settings.plan);
    S.serverPlan = C && C.user ? (pro ? (C.isAdmin ? 'admin' : 'pro') : 'demo') : null;
  }
  function checkEmailSheet(email) {
    sheet('<h2>Revisa tu correo</h2>' +
      '<p>Hemos creado tu cuenta de Mediciona. Para activarla:</p>' +
      '<ol class="steps"><li>Abre el correo de <b>' + esc(email) + '</b>.</li>' +
      '<li>Busca un mensaje de <b>Mediciona</b> (hola@mediciona.es) con el asunto <b>«Confirma tu cuenta de Mediciona»</b>. Si no está, mira en <b>Spam</b> o <b>Promociones</b>.</li>' +
      '<li>Pulsa <b>«Confirmar mi cuenta»</b>. Se abrirá Mediciona con tu sesión iniciada.</li></ol>' +
      '<p class="hint" id="resmsg">El correo puede tardar unos minutos.</p>' +
      '<div class="row"><button class="btn" id="resend" type="button">Reenviar el correo</button><button class="btn primary" type="button" data-a="login">Ya lo he confirmado: entrar</button></div>');
    $('#resend').addEventListener('click', async () => {
      try { await Cloud.resendConfirmation(email); $('#resmsg').textContent = 'Correo reenviado. Revisa también Spam y Promociones.'; } catch (e) { $('#resmsg').textContent = e.message; }
    });
  }
  async function syncNow() {
    if (!window.Cloud || !Cloud.user) return;
    try {
      const merged = await Cloud.syncObras(S.obras);
      for (const o of merged) await StorageAdapter.put('obras', o);
      const ids = new Set(merged.map((o) => o.id));
      S.obras = merged.concat(S.obras.filter((o) => !ids.has(o.id) && o.ejemplo));
      if (S.obra) { const cur = S.obras.find((o) => o.id === S.obra.id); if (cur && cur !== S.obra && (cur.updated || 0) > (S.obra.updated || 0)) { S.obra = cur; dialog.obra = cur; } }
      if (S.view !== 'obra') render();
    } catch (e) { /* sin conexión: se reintenta luego */ }
  }
  /* ---- Panel de administración ---- */
  document.addEventListener('submit', async (ev) => {
    const f = ev.target.closest('.pricef'); if (!f) return;
    ev.preventDefault();
    const num = (v) => parseFloat(String(v).replace(',', '.'));
    const i = num(f.elements.in.value), o = num(f.elements.out.value);
    if (isNaN(i) || isNaN(o) || i < 0 || o < 0) return toast('Escribe los dos precios, por ejemplo 0,10 y 0,40.');
    try { await Cloud.savePrice(f.dataset.m, i, o); toast('Precio guardado'); S.adminTab = 'coste'; loadAdmin(); } catch (e) { toast(e.message); }
  });
  async function loadAdmin() {
    try { S.adminData = await Cloud.adminData(); } catch (e) { S.adminData = { error: e.message }; }
    if (S.view === 'admin') render();
  }
  function viewAdmin() {
    const d = S.adminData;
    if (!d) return '<p class="hint">Cargando…</p>';
    if (d.error) return '<p class="hint">No se pudo cargar: ' + esc(d.error) + '</p>';
    const tab = S.adminTab || 'usuarios';
    const nuevas = d.sugerencias.filter((s) => s.estado === 'nueva').length;
    const tokIn = d.ia.reduce((a, x) => a + (x.tokens_entrada || 0), 0), tokOut = d.ia.reduce((a, x) => a + (x.tokens_salida || 0), 0);
    let h = '<div class="kpis">' +
      '<div class="kpi"><b>' + d.usuarios.length + '</b><span>usuarios</span></div>' +
      '<div class="kpi"><b>' + d.usuarios.filter((u) => u.plan === 'pro').length + '</b><span>en plan Pro</span></div>' +
      '<div class="kpi"><b>' + d.usuarios.reduce((a, u) => a + Number(u.obras_pagadas || 0), 0) + '</b><span>obras pagadas</span></div>' +
      '<div class="kpi"><b>' + nuevas + '</b><span>sugerencias nuevas</span></div>' +
      '<div class="kpi"><b>' + d.ia.length + '</b><span>consultas IA (30 días)</span></div></div>';
    h += '<div class="chips">' + [['usuarios', 'Usuarios'], ['sugerencias', 'Sugerencias' + (nuevas ? ' (' + nuevas + ')' : '')], ['coste', 'Coste IA'], ['ia', 'Uso de la IA']].map(([k, l]) => '<button class="chip' + (tab === k ? ' primary' : '') + '" data-a="admtab" data-tab="' + k + '">' + l + '</button>').join('') + '<button class="chip ghost" data-a="admin">Actualizar</button></div>';
    const fd = (x) => x ? new Date(x).toLocaleDateString('es-ES') : '—';
    if (tab === 'usuarios') {
      h += '<div class="tablewrap"><table class="lines admin"><thead><tr><th>Usuario</th><th>Empresa · NIF</th><th>Teléfono</th><th>Plan</th><th>Obras</th><th>IA</th><th>Alta</th><th>Actividad</th></tr></thead><tbody>' +
        d.usuarios.map((u) => '<tr><td class="com">' + esc(u.nombre || '—') + '<span class="e">' + esc(u.email) + '</span></td><td class="com">' + esc(u.empresa || '—') + '<span class="e">' + esc(u.nif || '') + '</span></td><td>' + (u.telefono_verificado ? esc(u.telefono) : '—') + '</td><td>' + esc(u.plan) + '</td><td>' + u.obras + (u.obras_pagadas ? ' (' + u.obras_pagadas + ' pag.)' : '') + '</td><td>' + u.consultas_ia + '</td><td>' + fd(u.creado) + '</td><td>' + fd(u.ultima_actividad) + '</td></tr>').join('') + '</tbody></table></div>';
      if (!d.usuarios.length) h += '<p class="hint">Todavía no hay usuarios registrados.</p>';
    } else if (tab === 'sugerencias') {
      if (!d.sugerencias.length) h += '<p class="hint">Todavía no hay sugerencias.</p>';
      const who = new Map(d.usuarios.map((u) => [u.id, u]));
      d.sugerencias.forEach((s) => {
        const u = who.get(s.user_id);
        h += '<div class="card"><div class="row" style="justify-content:space-between"><span class="badge' + (s.estado === 'nueva' ? ' ex' : s.estado === 'hecha' ? ' pro' : '') + '">' + esc(s.estado) + '</span><span class="meta">' + esc(s.tipo) + ' · ' + new Date(s.creada).toLocaleString('es-ES') + '</span></div>' +
          '<div style="white-space:pre-wrap">' + esc(s.mensaje) + '</div><div class="meta">' + esc(u ? (u.nombre || u.email) + (u.empresa ? ' · ' + u.empresa : '') : 'usuario borrado') + '</div>' +
          (s.conversacion ? '<details><summary class="meta">Conversación adjunta (' + s.conversacion.length + ' mensajes)</summary><div class="meta" style="white-space:pre-wrap">' + esc(s.conversacion.map((r) => (r.who === 'user' ? 'OÍDO: ' : 'APP: ') + r.text).join('\n')) + '</div></details>' : '') +
          '<div class="row">' + ['leida', 'hecha', 'descartada'].map((st) => '<button class="btn small" data-a="sgstate" data-id="' + s.id + '" data-st="' + st + '">' + { leida: 'Leída', hecha: 'Hecha', descartada: 'Descartar' }[st] + '</button>').join('') + '</div></div>';
      });
    } else if (tab === 'coste') {
      const usd = (v) => v == null ? '—' : '$' + Number(v).toLocaleString('es-ES', { minimumFractionDigits: v < 1 ? 4 : 2, maximumFractionDigits: v < 1 ? 4 : 2 });
      const tot = Object.fromEntries((d.iaTotales || []).map((r) => [r.periodo, r]));
      const sinPrecio = !(d.precios || []).length;
      const T = (k) => tot[k] || { consultas: 0, obras: 0, coste_usd: null };
      const medio = T('total').obras ? Number(T('total').coste_usd || 0) / Number(T('total').obras) : null;
      h += '<div class="kpis">' +
        '<div class="kpi"><b>' + usd(T('hoy').coste_usd) + '</b><span>hoy · ' + T('hoy').consultas + ' consultas</span></div>' +
        '<div class="kpi"><b>' + usd(T('mes').coste_usd) + '</b><span>este mes · ' + T('mes').consultas + ' consultas</span></div>' +
        '<div class="kpi"><b>' + usd(T('total').coste_usd) + '</b><span>total · ' + T('total').obras + ' mediciones</span></div>' +
        '<div class="kpi"><b>' + usd(medio) + '</b><span>coste medio por medición</span></div></div>';
      if (sinPrecio) h += '<p class="hint" style="color:var(--accent)">Introduce el precio del modelo para ver el coste en dólares. Hasta entonces se muestran los tokens.</p>';
      const modelos = [...new Set((d.ia || []).map((x) => x.modelo).concat((d.precios || []).map((p) => p.modelo)).concat(['gemini-flash-lite-latest']).filter(Boolean))];
      h += '<div class="card"><h3>Precio del modelo (USD por millón de tokens)</h3><p class="hint">Cópialo de la página de precios de la API de Gemini (plan de pago). Se aplica a las consultas nuevas y a las antiguas que no tenían precio.</p>' +
        modelos.map((m) => { const p = (d.precios || []).find((x) => x.modelo === m) || {}; return '<form class="row pricef" data-m="' + esc(m) + '" style="align-items:flex-end"><div class="field" style="flex:1 1 160px"><label>Modelo</label><input value="' + esc(m) + '" disabled></div><div class="field" style="flex:1 1 100px"><label>Entrada</label><input name="in" inputmode="decimal" value="' + (p.entrada_usd_millon != null ? String(p.entrada_usd_millon).replace('.', ',') : '') + '" placeholder="0,10"></div><div class="field" style="flex:1 1 100px"><label>Salida</label><input name="out" inputmode="decimal" value="' + (p.salida_usd_millon != null ? String(p.salida_usd_millon).replace('.', ',') : '') + '" placeholder="0,40"></div><button class="btn primary" type="submit">Guardar</button></form>'; }).join('') + '</div>';
      const rows = d.iaObras || [];
      h += '<div class="tablewrap"><table class="lines admin"><thead><tr><th>Medición (obra)</th><th>Usuario</th><th>Consultas</th><th>Tokens entrada / salida</th><th>Coste</th><th>Última</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td class="com">' + esc(r.titulo || (r.obra_id ? 'Obra sin sincronizar' : 'Sin obra')) + '<span class="e">' + esc(r.obra_id || '') + '</span></td><td class="com">' + esc(r.empresa || '') + '<span class="e">' + esc(r.email || '') + '</span></td><td>' + r.consultas + '</td><td>' + Number(r.tokens_entrada || 0).toLocaleString('es-ES') + ' / ' + Number(r.tokens_salida || 0).toLocaleString('es-ES') + '</td><td class="p">' + usd(r.coste_usd) + '</td><td>' + fd(r.ultima) + '</td></tr>').join('') + '</tbody></table></div>';
      if (!rows.length) h += '<p class="hint">Todavía no hay consultas a la IA.</p>';
    } else {
      const byIntent = {}; d.ia.forEach((x) => { byIntent[x.intent || '—'] = (byIntent[x.intent || '—'] || 0) + 1; });
      const ms = d.ia.length ? Math.round(d.ia.reduce((a, x) => a + (x.ms || 0), 0) / d.ia.length) : 0;
      h += '<div class="card"><h3>Últimos 30 días</h3><div class="meta">' + d.ia.length + ' consultas · ' + tokIn.toLocaleString('es-ES') + ' tokens de entrada · ' + tokOut.toLocaleString('es-ES') + ' de salida · ' + ms + ' ms de media</div>' +
        '<div class="meta">Por tipo: ' + Object.entries(byIntent).map(([k, v]) => esc(k) + ' ' + v).join(' · ') + '</div>' +
        '<p class="hint">El coste exacto se consulta en la facturación de Google (AI Studio). Con estos tokens puedes estimarlo según el precio del modelo.</p></div>';
    }
    return h;
  }
  async function exportLog() {
    const o = S.obra || S.obras[0]; if (!o) return toast('No hay obra abierta.');
    const lines = (o.registro || []).map((r) => r.t.replace('T', ' ').slice(0, 19) + ' | ' + (r.who === 'user' ? 'OÍDO' : 'APP ') + ' | ' + (r.est || '-') + ' | ' + (r.partida || '-') + ' | ' + r.text);
    if (!lines.length) return toast('Todavía no hay conversación registrada en esta obra.');
    await saveFile('registro-' + o.titulo.replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, '_').slice(0, 40) + '.txt', new Blob(['Registro de conversación · ' + o.titulo + '\n\n' + lines.join('\n') + '\n'], { type: 'text/plain' }));
  }
  function confirmSheet(msg, okLabel, fn) {
    sheet('<h2>' + esc(msg) + '</h2><div class="row"><button class="btn danger" id="cfok">' + esc(okLabel) + '</button><button class="btn" data-a="closesheet">Cancelar</button></div>');
    $('#cfok').addEventListener('click', () => { closeSheet(); fn(); });
  }

  document.addEventListener('click', async (ev) => {
    const chip = ev.target.closest('[data-chip]');
    if (chip && !S.session && !S.ended) { VoiceAdapter.unlock(); keepAwake(); S.session = true; renderMic(); }
    if (chip) { const c = S.chips[+chip.dataset.chip]; VoiceAdapter.stopSpeaking(); if (c) dialog.handle(c); return; }
    const el = ev.target.closest('[data-a]');
    if (!el) return;
    const a = el.dataset.a;
    if (a === 'closesheet-bg') { if (ev.target === el) closeSheet(); return; }
    switch (a) {
      case 'closesheet': closeSheet(); break;
      case 'install': closeSheet(); doInstall(); break;
      case 'iosclose': { const g = $('.ios-guide'); if (g) g.remove(); try { localStorage.setItem('iosGuideSeen', '1'); } catch (e) {} break; }
      case 'toastact': { $('#toast').hidden = true; const fn = toastAction && toastAction.fn; toastAction = null; if (fn) fn(); break; }
      case 'newobra': newObraSheet(); break;
      case 'open': openObra(el.dataset.id); break;
      case 'obras': closeSheet(); goObras(); break;
      case 'menu-obra': case 'back2obra': closeSheet(); S.view = 'obra'; render(); break;
      case 'resumen': closeSheet(); S.view = 'resumen'; render(); break;
      case 'catalogos': closeSheet(); S.view = 'catalogos'; render(); break;
      case 'ajustes': closeSheet(); S.view = 'ajustes'; render(); break;
      case 'ayuda': abrirManual(); break;
      case 'manual': abrirManual(el.dataset.s); break;
      case 'mclose': cerrarManual(); break;
      case 'sugerencias': closeSheet(); suggestionSheet(); break;
      case 'login': closeSheet(); accountSheet('login'); break;
      case 'signup': closeSheet(); accountSheet('signup'); break;
      case 'account': closeSheet(); accountSheet(Cloud.user ? 'perfil' : 'login'); break;
      case 'admin': closeSheet(); S.view = 'admin'; S.adminData = null; render(); loadAdmin(); break;
      case 'admtab': S.adminTab = el.dataset.tab; render(); break;
      case 'sgstate': { try { await Cloud.setSuggestionState(+el.dataset.id, el.dataset.st); if (S.sgNew) S.sgNew = Math.max(0, S.sgNew - 1); const s = (S.adminData.sugerencias || []).find((x) => x.id === +el.dataset.id); if (s) s.estado = el.dataset.st; render(); } catch (e) { toast(e.message); } break; }
      case 'logout': closeSheet(); logout(); break;
      case 'undo': closeSheet(); $('#toast').hidden = true; if (S.obra) { dialog.handle('deshacer'); render(); } break;
      case 'share': { closeSheet(); const o = S.obras.find((x) => x.id === el.dataset.id) || S.obra; await loadCatalog((o && o.catalogo) || 'palma48'); shareSheet(o); break; }
      case 'sendmail': { closeSheet(); const o = S.obras.find((x) => x.id === el.dataset.id) || S.obra; sendSheet(o); break; }
      case 'xlsx': case 'bc3': { closeSheet(); const o = S.obras.find((x) => x.id === el.dataset.id) || S.obra; if (o) exportFile(o, a); break; }
      case 'pdf': { closeSheet(); const o = S.obras.find((x) => x.id === el.dataset.id) || S.obra; if (o) { await loadCatalog(o.catalogo || 'palma48'); exportPdf(o); } break; }
      case 'delobra': { const o = S.obras.find((x) => x.id === el.dataset.id); confirmSheet('¿Borrar la obra «' + o.titulo + '»?', 'Borrar obra', async () => { S.obras = S.obras.filter((x) => x.id !== o.id); await StorageAdapter.del('obras', o.id); if (window.Cloud) Cloud.deleteObra(o.id); if (S.obra && S.obra.id === o.id) S.obra = null; render(); }); break; }
      case 'estancia': if (S.obra.ambito) { VoiceAdapter.stopSpeaking(); dialog.handle('siguiente estancia'); } break;
      case 'close': dialog.handle('siguiente partida'); break;
      case 'chg': case 'pickp': sayToken++; VoiceAdapter.stopSpeaking(); VoiceAdapter.stopListening(); pickSheet(); break;
      case 'pickdoc': { const d = catFor(S.obra).byCode.get(el.dataset.code); closeSheet(); if (d) { if (!S.session && !S.ended) { VoiceAdapter.unlock(); S.session = true; } dialog.replaceActive(d); } break; }
      case 'stop': dialog.stopAll(); break;
      case 'exportlog': closeSheet(); exportLog(); break;
      case 'addl': editLineSheet(-1, true); break;
      case 'editl': editLineSheet(+el.dataset.i, false); break;
      case 'dell': { const p = dialog.active(); const i = +el.dataset.i; dialog.snapshot(); p.lineas.splice(i, 1); saveObra(); render(); toast('Línea ' + (i + 1) + ' borrada', true); break; }
      case 'goto': S.obra.activa = el.dataset.uid; S.view = 'obra'; saveObra(); render(); { const p = dialog.active(); dialog.state = { mode: 'idle' }; say('Partida ' + p.r + '. Total ' + E.fmt(E.totalOf(p)) + ' ' + E.unitSpoken(p.u) + '. ' + E.dimsSpec(p).ask, dialog.idleChips()); } break;
      case 'fest': S.filterEst = el.dataset.e; render(); break;
      case 'logodel': S.settings.logo = ''; await saveSettings(); render(); break;
      case 'guiada': if (dialog.conversa && dialog.conversa.activo) { if (!S.session && !S.ended) { VoiceAdapter.unlock(); S.session = true; } S.view = 'obra'; render(); dialog.conversa.aGuiado(); } else if (dialog.guia) { if (!S.session && !S.ended) { VoiceAdapter.unlock(); S.session = true; } S.view = 'obra'; dialog.guia.start(); render(); } break;
      case 'trabajos': if (dialog.guia) { if (!S.session && !S.ended) { VoiceAdapter.unlock(); S.session = true; } dialog.guia.abrirTrabajos(); } break;
      case 'tw': { const sel = Guia.seleccion(S.obra); const s = sel[el.dataset.id]; if (s) { s.on = !s.on; s.todas = false; s.manual = true; if (s.on && !s.zonas.length) { const w = Guia.trabajosPara(S.obra).find((x) => x.id === el.dataset.id); s.zonas = Guia.zonasDe(S.obra, w).map((z) => z.id); } } saveObra(); render(); break; }
      case 'tz': { const s = Guia.seleccion(S.obra)[el.dataset.id]; const z = el.dataset.z; if (s) { s.todas = false; s.manual = true; s.zonas = s.zonas.includes(z) ? s.zonas.filter((x) => x !== z) : s.zonas.concat([z]); if (!s.zonas.length) s.on = false; } saveObra(); render(); break; }
      case 'tamb': S.tamb = el.dataset.v; render(); break;
      case 'tnew': {
        const desc = ($('#tnd').value || '').trim(); if (desc.length < 3) { toast('Escribe la descripción del trabajo'); break; }
        const zs = (S.obra.toma && S.obra.toma.zonas) || []; const a = S.tamb || (zs.some((z) => z.ambito === 'interior') ? 'interior' : zs[0] ? zs[0].ambito : 'interior');
        const zsel = $('#tnz') && $('#tnz').value ? [$('#tnz').value] : null;
        Guia.anadirPropia(S.obra, desc.charAt(0).toUpperCase() + desc.slice(1), $('#tnu').value, a, zsel); saveObra(); render(); toast('Partida creada: ' + desc); break;
      }
      case 'zedit': { const z = ((S.obra.toma && S.obra.toma.zonas) || []).find((x) => x.id === el.dataset.z); if (z) editZonaSheet(z); break; }
      case 'zdel': {
        const z = ((S.obra.toma && S.obra.toma.zonas) || []).find((x) => x.id === el.dataset.z); if (!z) break;
        confirmSheet('¿Eliminar «' + z.nombre + '» y todo lo medido en ella?', 'Eliminar', () => { dialog.snapshot(); Guia.borrarZona(S.obra, z.id); if (S.obra.partidas.some((p) => p.guia)) Guia.generar(S.obra, catFor(S.obra)); saveObra(); render(); toast('Eliminado: ' + z.nombre, true); });
        break;
      }
      case 'tadd': { const d = catFor(S.obra).byCode.get(el.dataset.code); const zs = (S.obra.toma && S.obra.toma.zonas) || []; const a = S.tamb || (zs[0] && zs[0].ambito) || 'interior'; if (d) { Guia.anadirExtra(S.obra, d, a); S.tq = ''; saveObra(); render(); toast('Añadida: ' + d.r); } break; }
      case 'tgen': { if (!S.session && !S.ended) { VoiceAdapter.unlock(); S.session = true; } sayToken++; VoiceAdapter.stopSpeaking(); if (dialog.conversa && dialog.conversa.activo) { S.view = 'obra'; dialog.conversa.aplicar({ accion: 'generar', zonas: [], trabajos: [] }, ''); } else if (dialog.guia) { dialog.guia.g.paso = 'trabajos'; dialog.guia.g.fin = false; dialog.guia.generarMediciones(); } break; }
      case 'tmedir': S.view = 'obra'; render(); if (dialog.guia) dialog.handle('medir algo más'); break;
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
      case 'testvoice': VoiceAdapter.speak('Hola, soy el asistente de Mediciona. Dime la partida y vamos midiendo.'); break;
    }
  });
  document.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'femp') return;
    ev.preventDefault();
    const nif = $('#enif').value.trim().toUpperCase();
    if (nif && !nifValido(nif)) return toast('El NIF / CIF no es válido. Revísalo.');
    S.settings.empresa = { nombre: $('#enom').value.trim(), nif, direccion: $('#edir').value.trim(), telefono: $('#etel').value.trim() };
    await saveSettings(); toast('Datos de la empresa guardados'); render();
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'tq') { S.tq = ev.target.value; $('#tres').innerHTML = tResults(); }
    if (ev.target.id === 'catq') { S.catQ = ev.target.value; $('#catres').innerHTML = catResults(); }
    if (ev.target.id === 'rate') { S.settings.rate = +ev.target.value; VoiceAdapter.setRate(S.settings.rate); ev.target.previousElementSibling.textContent = 'Velocidad de lectura: ' + S.settings.rate.toFixed(2); saveSettings(); }
  });
  document.addEventListener('change', async (ev) => {
    if (ev.target.dataset && ev.target.dataset.a === 'trule') { const w = ((S.obra.guia && S.obra.guia.extra) || []).find((x) => x.id === ev.target.dataset.id); if (w) { w.regla = ev.target.value; saveObra(); } }
    if (ev.target.id === 'chkia') { S.settings.ia = ev.target.checked; saveSettings(); }
    if (ev.target.id === 'chkauri') { S.settings.auriculares = ev.target.checked; VoiceAdapter.setEcho(!ev.target.checked); saveSettings(); }
    if (ev.target.id === 'chktono') { S.settings.tono = ev.target.checked; VoiceAdapter.setPitchQ(ev.target.checked); saveSettings(); if (ev.target.checked) VoiceAdapter.speak('¿Se nota que te pregunto?').then(() => VoiceAdapter.earcon()); }
    if (ev.target.id === 'chkbreve') { S.settings.breve = ev.target.checked; saveSettings(); }
    if (ev.target.id === 'chkconfirm') { S.settings.confirm = ev.target.checked; saveSettings(); }
    if (ev.target.id === 'chkvozn') { S.settings.vozNatural = ev.target.checked; saveSettings(); configurarVoz(); VoiceAdapter.speak('Así sueno ahora.'); }
    if (ev.target.id === 'selvozn') { S.settings.vozNombre = ev.target.value; saveSettings(); configurarVoz(); VoiceAdapter.speak('Hola, así suena esta voz. ¿Seguimos midiendo?'); }
    if (ev.target.id === 'selvoice') { S.settings.voice = ev.target.value; VoiceAdapter.setVoice(ev.target.value); saveSettings(); VoiceAdapter.speak('Así sueno ahora.'); }
    if (ev.target.id === 'bc3file' && ev.target.files[0]) importBC3(ev.target.files[0]);
    if (ev.target.id === 'restorefile' && ev.target.files[0]) restore(ev.target.files[0]);
    if (ev.target.id === 'logofile' && ev.target.files[0]) { try { S.settings.logo = await leerLogo(ev.target.files[0]); await saveSettings(); render(); toast('Logo guardado: saldrá en el PDF'); } catch (e) { toast(e.message); } }
  });
  $('#btnHelp').addEventListener('click', () => (S.view === 'manual' ? cerrarManual() : abrirManual()));
  $('#btnBack').addEventListener('click', () => { if (S.view === 'manual') return cerrarManual(); if (S.view === 'obra' || !S.obra) goObras(); else if (S.view === 'trabajos') { S.view = 'obra'; render(); } else { S.view = 'obra'; render(); } });
  $('#btnMenu').addEventListener('click', menuSheet);
  $('#btnSol').addEventListener('click', () => { S.settings.mode = S.settings.mode === 'sol' ? 'obra' : 'sol'; saveSettings(); render(); });
  $('#btnDock').addEventListener('click', () => { S.settings.dockMin = !S.settings.dockMin; saveSettings(); renderMic(); });
  $('#btnHands').addEventListener('click', () => { S.settings.hands = !S.settings.hands; saveSettings(); renderMic(); });
  $('#btnKeyboard').addEventListener('click', () => { S.typing = !S.typing; renderMic(); if (S.typing) { VoiceAdapter.stopListening(); $('#typein').focus(); } });
  $('#typebar').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#typein').value.trim(); if (!v) return; $('#typein').value = ''; if (!S.session) { VoiceAdapter.unlock(); S.session = true; } VoiceAdapter.stopSpeaking(); dialog.handle(v); });
  $('#btnMic').addEventListener('click', () => {
    // Debe ejecutarse sincrónicamente dentro del gesto del usuario.
    if (!S.session) return startSession();
    if (VoiceAdapter.mode === 'none') { S.typing = true; renderMic(); warnVoice('Este navegador no permite reconocimiento de voz. Usa Chrome (Android) o Safari (iPhone), o escribe las órdenes.'); return; }
    if (VoiceAdapter.listening && !VoiceAdapter.speaking) { VoiceAdapter.stopListening(); return; }
    const hablaba = VoiceAdapter.speaking;
    sayToken++; VoiceAdapter.stopSpeaking(); noSpeech = 0; S.micBlocked = false;
    // Tras cortar la voz, se deja apagar el altavoz un instante antes de abrir el micro (en iPhone el micro exige abrirse dentro del toque)
    if (hablaba && !isIOS()) setTimeout(() => VoiceAdapter.listen(true), 300);
    else VoiceAdapter.listen(true);
  });
  $('#btnStart').addEventListener('click', () => startSession());
  function goObras() { S.greetPending = false; S.session = false; S.ended = false; releaseAwake(); VoiceAdapter.stopSpeaking(); VoiceAdapter.stopListening(); sayToken++; S.view = 'obras'; render(); }

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
  /** Excel (.xlsx) y BC3 (FIEBDC-3 con mediciones, sin precios). */
  async function exportFile(obra, kind) {
    if (!obra) return;
    if (!obra.partidas.some((p) => p.lineas.length)) return toast('La obra no tiene mediciones todavía.');
    const base = 'Mediciona_' + obra.titulo.replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, '_').slice(0, 60);
    try {
      const X = window.Exporters;
      const blob = kind === 'xlsx'
        ? new Blob([X.buildXLSX(obra)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        : new Blob([X.buildBC3(obra)], { type: 'application/octet-stream' });
      await fileReady(base + '.' + kind, blob, kind === 'xlsx' ? 'Excel' : 'BC3');
    } catch (e) { console.error(e); toast('No se pudo generar el archivo: ' + e.message); }
  }
  /* ---- Enviar los archivos al correo registrado del usuario ---- */
  function makeFile(obra, kind) {
    const base = 'Mediciona_' + obra.titulo.replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, '_').slice(0, 60);
    if (kind === 'pdf') return { nombre: base + '.pdf', blob: new Blob([buildPdf(obra, window.jspdf.jsPDF).output('blob')], { type: 'application/pdf' }) };
    if (kind === 'xlsx') return { nombre: base + '.xlsx', blob: new Blob([window.Exporters.buildXLSX(obra)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) };
    return { nombre: base + '.bc3', blob: new Blob([window.Exporters.buildBC3(obra)], { type: 'application/octet-stream' }) };
  }
  const toB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
  /* ---- Compartir los archivos (WhatsApp, correo, Drive, Archivos…) con la hoja de compartir del sistema ---- */
  function shareSheet(obra) {
    obra = obra || S.obra;
    if (!obra) return toast('Abre primero una obra.');
    if (!obra.partidas.some((p) => p.lineas.length)) return toast('La obra no tiene mediciones todavía.');
    const puede = !!(navigator.share && navigator.canShare);
    sheet('<h2>Compartir archivos</h2><p class="hint">Elige los archivos de «' + esc(obra.titulo) + '» y envíalos por WhatsApp, correo, Drive o guárdalos en Archivos.</p>' +
      '<div class="menu-list">' + [['pdf', 'PDF de mediciones', true], ['xlsx', 'Excel (.xlsx)', false], ['bc3', 'BC3 (Presto / Arquímedes)', false]].map(([k, l, on]) => '<label class="checkline"><input type="checkbox" class="sharek" value="' + k + '"' + (on ? ' checked' : '') + '><span style="color:var(--fg)">' + l + '</span></label>').join('') + '</div>' +
      (puede ? '' : '<p class="hint">Este navegador no permite compartir archivos: se descargarán en el dispositivo.</p>') +
      '<p class="hint" id="sharemsg"></p>' +
      '<div class="row"><button class="btn primary" id="sharego" type="button">' + (puede ? 'Compartir' : 'Descargar') + '</button><button class="btn" data-a="closesheet" type="button">Cancelar</button></div>');
    $('#sharego').addEventListener('click', async () => {
      const kinds = [...document.querySelectorAll('.sharek:checked')].map((x) => x.value);
      if (!kinds.length) { $('#sharemsg').textContent = 'Elige al menos un archivo.'; return; }
      let fs;
      try { fs = kinds.map((k) => makeFile(obra, k)); } catch (e) { $('#sharemsg').textContent = 'No se pudo generar: ' + e.message; return; }
      // El navegador debe aceptar los tipos de archivo; si no, se prueban tipos equivalentes
      const alt = { xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'], bc3: ['application/octet-stream', 'text/plain'], pdf: ['application/pdf'] };
      const opciones = (t) => fs.map((f, i) => new File([f.blob], f.nombre, { type: t === 0 ? f.blob.type : (alt[kinds[i]][t] || alt[kinds[i]][0]) }));
      let files = null;
      if (puede) for (let t = 0; t < 3 && !files; t++) { const cand = opciones(t); try { if (navigator.canShare({ files: cand })) files = cand; } catch (e) {} }
      if (files) {
        try { await navigator.share({ files, title: obra.titulo, text: 'Mediciones · ' + obra.titulo }); closeSheet(); toast('Archivos compartidos'); }
        catch (e) { if (e && e.name !== 'AbortError') $('#sharemsg').textContent = 'No se pudo compartir: ' + e.message; }
        return;
      }
      for (const f of fs) await saveFile(f.nombre, f.blob);
      closeSheet(); toast(puede ? 'Este dispositivo no deja compartir estos archivos: los he descargado.' : 'Archivos descargados.');
    });
  }
  function sendSheet(obra) {
    obra = obra || S.obra;
    if (!obra) return toast('Abre primero una obra.');
    if (!window.Cloud || !Cloud.user) { toast('Para enviar los archivos a tu correo, entra en tu cuenta.'); return accountSheet('login'); }
    if (!obra.partidas.some((p) => p.lineas.length)) return toast('La obra no tiene mediciones todavía.');
    sheet('<h2>Enviar a mi correo</h2><p class="hint">«' + esc(obra.titulo) + '» se enviará a <b>' + esc(Cloud.user.email) + '</b>.</p>' +
      '<div class="menu-list">' + [['pdf', 'PDF de mediciones', true], ['xlsx', 'Excel (.xlsx)', false], ['bc3', 'BC3 (Presto / Arquímedes)', false]].map(([k, l, on]) => '<label class="checkline"><input type="checkbox" class="sendk" value="' + k + '"' + (on ? ' checked' : '') + '><span style="color:var(--fg)">' + l + '</span></label>').join('') + '</div>' +
      '<p class="hint" id="sendmsg"></p>' +
      '<div class="row"><button class="btn primary" id="sendgo" type="button">Enviar</button><button class="btn" data-a="closesheet" type="button">Cancelar</button></div>');
    $('#sendgo').addEventListener('click', async () => {
      const kinds = [...document.querySelectorAll('.sendk:checked')].map((x) => x.value);
      if (!kinds.length) { $('#sendmsg').textContent = 'Elige al menos un archivo.'; return; }
      const btn = $('#sendgo'); btn.disabled = true; $('#sendmsg').textContent = 'Preparando y enviando…';
      try {
        await loadCatalog(obra.catalogo || 'palma48');
        const archivos = [];
        for (const k of kinds) { const f = makeFile(obra, k); archivos.push({ nombre: f.nombre, base64: await toB64(f.blob) }); }
        const r = await Cloud.sendFiles({ obra_id: obra.id, titulo: obra.titulo, archivos });
        closeSheet(); toast('Enviado a ' + (r.a || Cloud.user.email) + '. Revisa tu correo.');
      } catch (e) { $('#sendmsg').textContent = e.message; btn.disabled = false; }
    });
  }
  async function exportPdf(obra) {
    if (!obra) return;
    const J = window.jspdf && window.jspdf.jsPDF;
    if (!J) return toast('El generador de PDF no está disponible.');
    const doc = buildPdf(obra, J);
    const name = 'Mediciona_' + obra.titulo.replace(/[^\wáéíóúñÁÉÍÓÚÑ-]+/g, '_').slice(0, 60) + '.pdf';
    await fileReady(name, new Blob([doc.output('blob')], { type: 'application/pdf' }), 'PDF');
  }
  function buildPdf(obra, J) {
    const doc = new J({ unit: 'mm', format: 'a4' });
    // Fuente incrustada: evita que los visores del móvil junten las palabras al sustituir Helvetica
    let FONT = 'helvetica';
    if (window.PDF_FONTS) {
      try {
        doc.addFileToVFS('LS-R.ttf', window.PDF_FONTS.regular); doc.addFont('LS-R.ttf', 'LiberationSans', 'normal');
        doc.addFileToVFS('LS-B.ttf', window.PDF_FONTS.bold); doc.addFont('LS-B.ttf', 'LiberationSans', 'bold');
        doc.addFileToVFS('LS-I.ttf', window.PDF_FONTS.italic); doc.addFont('LS-I.ttf', 'LiberationSans', 'italic');
        FONT = 'LiberationSans';
      } catch (e) { FONT = 'helvetica'; }
    }
    const _sf = doc.setFont.bind(doc);
    doc.setFont = (f, st) => _sf(f === 'helvetica' ? FONT : f, st === 'bolditalic' ? 'bold' : st);
    const caps = E.obraChapters(obra).map((c) => Object.assign({}, c, { partidas: c.partidas.filter((p) => p.lineas.length) })).filter((c) => c.partidas.length);
    const M = 12, W = 210, R = W - M, BOTTOM = 280;
    const X = { cod: M, ud: 30, res: 40, uds: 113, l: 130, a: 147, h: 164, par: 181, tot: R };
    const fecha = new Date().toLocaleDateString('es-ES');
    let y = 0;
    const txt = (s) => String(s ?? '').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/[^\x00-\xFF]/g, '');
    const right = (s, x, yy) => doc.text(txt(s), x, yy, { align: 'right' });
    // Empresa: logo y datos arriba de cada página
    const EMP = empresaDatos();
    const conEmp = !!(EMP.logo || EMP.nombre);
    let logoWH = null;
    if (EMP.logo) { try { const pr = doc.getImageProperties(EMP.logo); const h = 12, w = Math.min(40, h * pr.width / pr.height); logoWH = [w, w * pr.height / pr.width]; } catch (e) { logoWH = null; } }
    const OFF = conEmp ? 16 : 0;
    function header() {
      doc.setTextColor(15, 23, 42);
      if (conEmp) {
        let tx = M;
        if (logoWH) { try { doc.addImage(EMP.logo, 'PNG', M, 6, logoWH[0], logoWH[1]); tx = M + logoWH[0] + 4; } catch (e) { /* imagen no válida */ } }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); if (EMP.nombre) doc.text(txt(EMP.nombre), tx, 9.5, { maxWidth: 110 });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        const l2 = [EMP.nif ? 'NIF/CIF ' + EMP.nif : '', EMP.telefono ? 'Tel. ' + EMP.telefono : ''].filter(Boolean).join(' · ');
        if (l2) doc.text(txt(l2), tx, 13.5, { maxWidth: 110 });
        if (EMP.direccion) doc.text(txt(EMP.direccion), tx, 17, { maxWidth: 110 });
        doc.setDrawColor(200, 205, 215); doc.setLineWidth(0.2); doc.line(M, 20, R, 20);
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(txt(obra.titulo), M, 14 + OFF, { maxWidth: 130 });
      doc.setFontSize(10); right('ESTADO DE MEDICIONES', R, 14 + OFF);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(txt([obra.cliente, obra.ubicacion].filter(Boolean).join(' · ')), M, 19 + OFF);
      right(fecha, R, 19 + OFF);
      doc.setDrawColor(15, 23, 42); doc.setLineWidth(0.4); doc.line(M, 21 + OFF, R, 21 + OFF);
      doc.setFillColor(30, 41, 59); doc.rect(M, 23 + OFF, R - M, 6, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
      doc.text('Código', X.cod + 1, 27 + OFF); doc.text('Ud', X.ud, 27 + OFF); doc.text('Resumen / Comentario', X.res, 27 + OFF);
      right('Uds.', X.uds, 27 + OFF); right('Longitud', X.l, 27 + OFF); right('Anchura', X.a, 27 + OFF); right('Altura', X.h, 27 + OFF); right('Parcial', X.par, 27 + OFF); right('Total', X.tot - 1, 27 + OFF);
      doc.setTextColor(15, 23, 42);
      y = 34 + OFF;
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
          if (l.h !== null && l.h !== undefined) right(E.fmt(l.h), X.h, y); else if (l.hPend) right('falta', X.h, y);
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
      doc.text(txt('Mediciona · Mediciones de obra con IA · ' + obra.titulo), M, 291, { maxWidth: 150 });
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
    BillingGuard.plan = S.settings.plan; VoiceAdapter.setRate(S.settings.rate); VoiceAdapter.setPitchQ(S.settings.tono !== false); configurarVoz(); if (S.settings.voice) VoiceAdapter.setVoice(S.settings.voice);
    // Catálogo base embebido → IndexedDB en el primer arranque
    let cats = await StorageAdapter.all('catalogos');
    const stored = cats.find((c) => c.id === 'palma48');
    if (!stored || stored.nombre !== baseCatalog().nombre) { await StorageAdapter.put('catalogos', baseCatalog()); }
    S.cats = [{ id: 'palma48', nombre: baseCatalog().nombre, base: true, n: window.CATALOGO_BASE.partidas.length }].concat(cats.filter((c) => !c.base).map((c) => ({ id: c.id, nombre: c.nombre, base: false, n: c.n })));
    const cat = await loadCatalog('palma48');
    if (S.settings.catalogo !== 'palma48') await loadCatalog(S.settings.catalogo).catch(() => {});
    S.obras = await StorageAdapter.all('obras');
    if (!S.obras.length && !st) { const ex = exampleObra(cat); S.obras.push(ex); await StorageAdapter.put('obras', ex); await saveSettings(); }
    render();
    // Servidor: sesión, sincronización y recuperación de contraseña
    if (window.Cloud && Cloud.init()) {
      Cloud.onAuth((ev, user) => {
        applyServerPlan(); configurarVoz();
        if (ev === 'PASSWORD_RECOVERY') accountSheet('newpass');
        if (user && (ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION')) {
          syncNow();
          if (Cloud.isAdmin && !S.sgNotified) Cloud.newSuggestions().then((n) => { S.sgNew = n; if (n) { S.sgNotified = true; toast(n === 1 ? 'Tienes 1 sugerencia nueva' : 'Tienes ' + n + ' sugerencias nuevas', false, { label: 'Ver', fn: () => { S.view = 'admin'; S.adminTab = 'sugerencias'; S.adminData = null; render(); loadAdmin(); } }); } render(); }).catch(() => {});
        }
        if (S.view === 'obras' || S.view === 'ajustes') render();
      });
      window.addEventListener('online', () => { syncNow(); if (S.view === 'obras') render(); });
      window.addEventListener('offline', () => { if (S.view === 'obras') render(); });
    }
    // iPhone: mostrar una vez la guía de instalación
    try { if (isIOS() && !isStandalone() && !localStorage.getItem('iosGuideSeen')) setTimeout(iosGuide, 1500); } catch (e) {}
    VoiceAdapter.setEcho(S.settings.auriculares !== true);
    VoiceAdapter.init().then((m) => {
      if (m === 'none') {
        S.typing = true;
        warnVoice(window.claude ? 'Dentro de la app de Claude el micrófono no está disponible. Para medir por voz abre la app desde su propia dirección en Chrome (Android) o Safari (iPhone). Aquí puedes escribir.' : 'Este navegador no ofrece reconocimiento de voz: escribe las órdenes. Con voz funciona en Chrome (Android/PC) y Safari (iPhone).');
      }
      render();
    });
  }
  // Versión nueva publicada: se ofrece actualizar (sin recargar a mitad de una medición)
  window.MedicionaUpdate = () => toast('Hay una versión nueva de Mediciona', false, { label: 'Actualizar', fn: async () => { if (window.Cloud) await Cloud.flush(); location.reload(); } });
  window.MedicionesApp = { S, dialog, buildPdf, exportPdf, exportFile };
  boot();
})();

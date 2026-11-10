/*
 * Motores de reconocimiento de voz:
 *  - WebSpeechEngine: API nativa (Chrome/Edge/Safari). En Chrome necesita conexión.
 *  - WhisperEngine: Whisper en el navegador (Transformers.js + WebAssembly/WebGPU).
 *    Descarga el modelo la primera vez (con conexión) y luego funciona sin cobertura.
 * Ambos exponen: start(), stop(), onText(text, isFinal), onState(state, detail).
 */
(function (global) {
  'use strict';

  var TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';

  function noop() {}

  // ---------------------------------------------------------------- Web Speech
  function WebSpeechEngine(opts) {
    this.lang = opts.lang || 'es-ES';
    this.onText = noop; this.onState = noop;
    this.active = false; this.muted = false; this.rec = null;
  }
  WebSpeechEngine.isSupported = function () { return !!(global.SpeechRecognition || global.webkitSpeechRecognition); };
  WebSpeechEngine.prototype.start = function () {
    var self = this;
    if (!WebSpeechEngine.isSupported()) { this.onState('error', 'Este navegador no soporta la Web Speech API. Usa Chrome, Edge o Safari, o el motor Whisper.'); return Promise.resolve(); }
    this.active = true;
    this._spawn();
    return Promise.resolve();
  };
  WebSpeechEngine.prototype._spawn = function () {
    var self = this;
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    var rec = new SR();
    rec.lang = this.lang; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onstart = function () { self.onState('listening'); };
    rec.onresult = function (ev) {
      if (self.muted) return;
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var r = ev.results[i];
        self.onText(r[0].transcript, r.isFinal);
      }
    };
    rec.onerror = function (ev) {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      if (ev.error === 'network') self.onState('error', 'Sin conexión: el reconocimiento nativo de Chrome necesita internet. Cambia a Whisper (offline) en Ajustes.');
      else if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { self.active = false; self.onState('error', 'Permiso de micrófono denegado.'); }
      else self.onState('error', 'Error de voz: ' + ev.error);
    };
    rec.onend = function () {
      if (self.active) setTimeout(function () { if (self.active && self.rec === rec) self._spawn(); }, 250);
      else self.onState('idle');
    };
    this.rec = rec;
    try { rec.start(); } catch (e) { /* ya iniciado */ }
  };
  WebSpeechEngine.prototype.stop = function () {
    this.active = false;
    if (this.rec) try { this.rec.abort(); } catch (e) {}
    this.rec = null;
    this.onState('idle');
  };
  WebSpeechEngine.prototype.mute = function (m) { this.muted = m; };

  // ---------------------------------------------------------------- Whisper
  var whisperPipe = null, whisperModel = null;

  function WhisperEngine(opts) {
    this.model = opts.model || 'onnx-community/whisper-base';
    this.onText = noop; this.onState = noop;
    this.active = false; this.muted = false;
    this.queue = Promise.resolve();
  }
  WhisperEngine.isSupported = function () { return !!(navigator.mediaDevices && global.AudioContext); };

  WhisperEngine.load = function (model, onProgress) {
    if (whisperPipe && whisperModel === model) return Promise.resolve(whisperPipe);
    return import(TRANSFORMERS_URL).then(function (T) {
      T.env.allowLocalModels = false;
      try { T.env.backends.onnx.wasm.proxy = !navigator.gpu; } catch (e) {}
      var files = {};
      var device = navigator.gpu ? 'webgpu' : 'wasm';
      return T.pipeline('automatic-speech-recognition', model, {
        device: device,
        dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback: function (p) {
          if (p.status === 'progress' && p.file) {
            files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
            var l = 0, t = 0; Object.keys(files).forEach(function (k) { l += files[k].loaded; t += files[k].total; });
            onProgress && onProgress(t ? l / t : 0);
          }
        }
      }).catch(function (err) {
        if (device === 'webgpu') {
          return T.pipeline('automatic-speech-recognition', model, { device: 'wasm', dtype: 'q8' });
        }
        throw err;
      });
    }).then(function (p) { whisperPipe = p; whisperModel = model; return p; });
  };

  WhisperEngine.prototype.start = function () {
    var self = this;
    this.active = true;
    this.onState('loading', 0);
    return WhisperEngine.load(this.model, function (f) { self.onState('loading', f); })
      .then(function () {
        if (!self.active) return;
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      })
      .then(function (stream) {
        if (!stream) return;
        if (!self.active) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        self.stream = stream;
        self._startVAD(stream);
        self.onState('listening');
      })
      .catch(function (e) {
        self.active = false;
        self.onState('error', 'Whisper: ' + (e && e.message ? e.message : e) + '. La primera vez necesita conexión para descargar el modelo.');
      });
  };

  // Detección de voz por energía: graba cada frase y la transcribe al detectar silencio.
  WhisperEngine.prototype._startVAD = function (stream) {
    var self = this;
    var ctx;
    try { ctx = new AudioContext({ sampleRate: 16000 }); } catch (e) { ctx = new AudioContext(); }
    this.ctx = ctx;
    var src = ctx.createMediaStreamSource(stream);
    var proc = ctx.createScriptProcessor(2048, 1, 1);
    var sr = ctx.sampleRate;
    var floor = 0.01, speaking = false, silentMs = 0, speechMs = 0;
    var chunks = [], pre = [];
    var PRE_CHUNKS = Math.ceil(0.3 * sr / 2048);
    proc.onaudioprocess = function (ev) {
      var data = new Float32Array(ev.inputBuffer.getChannelData(0));
      var sum = 0; for (var i = 0; i < data.length; i++) sum += data[i] * data[i];
      var rms = Math.sqrt(sum / data.length);
      var ms = data.length / sr * 1000;
      if (self.muted) { speaking = false; chunks = []; return; }
      var thr = Math.max(0.012, floor * 3);
      if (!speaking) {
        floor = floor * 0.95 + rms * 0.05;
        pre.push(data); if (pre.length > PRE_CHUNKS) pre.shift();
        if (rms > thr) { speaking = true; chunks = pre.slice(); pre = []; silentMs = 0; speechMs = 0; self.onState('hearing'); }
      } else {
        chunks.push(data);
        speechMs += ms;
        if (rms < thr * 0.7) silentMs += ms; else silentMs = 0;
        if (silentMs > 900 || speechMs > 15000) {
          speaking = false;
          var audio = concat(chunks); chunks = [];
          if (speechMs > 350) self._transcribe(audio, sr);
          else self.onState('listening');
        }
      }
    };
    src.connect(proc); proc.connect(ctx.destination);
    this.proc = proc; this.src = src;
  };

  function concat(chunks) {
    var len = chunks.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Float32Array(len), off = 0;
    chunks.forEach(function (c) { out.set(c, off); off += c.length; });
    return out;
  }
  function resample(data, from) {
    if (from === 16000) return data;
    var ratio = from / 16000, len = Math.floor(data.length / ratio), out = new Float32Array(len);
    for (var i = 0; i < len; i++) out[i] = data[Math.floor(i * ratio)];
    return out;
  }

  WhisperEngine.prototype._transcribe = function (audio, sr) {
    var self = this;
    this.onState('processing');
    this.queue = this.queue.then(function () {
      return whisperPipe(resample(audio, sr), { language: 'spanish', task: 'transcribe' });
    }).then(function (out) {
      var text = (out && out.text || '').trim();
      // Whisper "alucina" frases típicas en silencio; las descartamos.
      if (text && !/^(\[.*\]|\(.*\)|gracias\.?|subtítulos.*|¡?gracias por ver.*)$/i.test(text)) self.onText(text, true);
      if (self.active) self.onState('listening');
    }).catch(function (e) { self.onState('error', 'Whisper: ' + e.message); });
  };

  WhisperEngine.prototype.stop = function () {
    this.active = false;
    try { this.proc && this.proc.disconnect(); this.src && this.src.disconnect(); } catch (e) {}
    try { this.ctx && this.ctx.close(); } catch (e) {}
    if (this.stream) this.stream.getTracks().forEach(function (t) { t.stop(); });
    this.stream = null;
    this.onState('idle');
  };
  WhisperEngine.prototype.mute = function (m) { this.muted = m; };

  // ---------------------------------------------------------------- Síntesis
  var Speaker = {
    enabled: true,
    voice: null,
    pickVoice: function () {
      if (!global.speechSynthesis) return;
      var vs = speechSynthesis.getVoices();
      Speaker.voice = vs.filter(function (v) { return /^es[-_]ES/i.test(v.lang) && v.localService; })[0]
        || vs.filter(function (v) { return /^es/i.test(v.lang); })[0] || null;
    },
    say: function (text, engine) {
      return new Promise(function (resolve) {
        if (!Speaker.enabled || !global.speechSynthesis || !text) return resolve();
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES'; u.rate = 1.15;
        if (Speaker.voice) u.voice = Speaker.voice;
        if (engine) engine.mute(true);
        var fired = false;
        var done = function () { if (fired) return; fired = true; setTimeout(function () { if (engine) engine.mute(false); resolve(); }, 250); };
        u.onend = done; u.onerror = done;
        speechSynthesis.speak(u);
        setTimeout(done, 8000);
      });
    }
  };
  if (global.speechSynthesis) { Speaker.pickVoice(); speechSynthesis.onvoiceschanged = Speaker.pickVoice; }

  global.Speech = { WebSpeechEngine: WebSpeechEngine, WhisperEngine: WhisperEngine, Speaker: Speaker };
})(window);

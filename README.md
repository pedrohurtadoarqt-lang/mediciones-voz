# Medición por voz (prototipo MVP)

Herramienta web 100 % cliente para tomar mediciones a pie de obra dictando, sobre una base de precios FIEBDC-3 (.bc3).

## Arrancar
- Rápido: abrir `index.html` en Chrome/Edge (doble clic). Funciona el BC3, la medición, el PDF y la voz nativa.
- Recomendado (necesario para Whisper offline e instalar como app): servir la carpeta por http y abrir `http://localhost:8000`:

      python3 -m http.server 8000

  Para usarlo en el móvil, publícalo en cualquier hosting estático con https (GitHub Pages, Netlify…) y "Añadir a pantalla de inicio".

## Flujo
1. Ajustes → Cargar archivo .bc3 (se parsea en un Web Worker y se guarda en IndexedDB).
2. Catálogo → buscar/explorar y elegir partida (o por voz: «buscar enfoscado maestreado», «opción 2»).
3. Pulsar el micrófono y dictar: «Dormitorio principal 4 con 50 por 3 con 20».
4. Visita → PDF de mediciones, BC3 con mediciones (~M, importable en Presto/Arquímedes) o copia JSON.

## Archivos
- `js/bc3-parser.js` – parser FIEBDC-3 (ANSI/850/437, jerarquía ~C/~D, textos ~T; descarta descompuestos).
- `js/voice-parser.js` – gramática de dictado en castellano (números en letra o cifra, «con/coma», «dos sesenta», «y medio», campos con nombre, deducciones, órdenes).
- `js/speech.js` – motores: Web Speech API y Whisper (Transformers.js, WebGPU/WASM) con detección de voz por energía; confirmación por SpeechSynthesis.
- `js/export.js` – PDF (jsPDF + autotable, cabecera repetida, «Suma y sigue», Página X de Y) y BC3 con ~M.
- `js/db.js`, `js/app.js`, `sw.js` (offline), `lib/` (jsPDF local, sin CDN).

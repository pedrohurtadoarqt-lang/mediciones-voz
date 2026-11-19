# Mediciones por Voz — prototipo HTML local

App de **Estado de Mediciones** por diálogo de voz, 100 % local, con la base **Precios de Mallorca 2026 (COAATMCA)** embebida (1.744 partidas, sin precios).

## Archivos
- `../index.html` (carpeta `app/`) — **la app publicada** en GitHub Pages: un solo archivo con catálogo, motor, jsPDF y fuente del PDF, más `sw.js` y `manifest.webmanifest` para instalarla y usarla sin conexión.
- El BC3 original no se sube al repositorio: para regenerar, `node build.js ruta/Palma48_2026_COAATMCA.bc3` y copiar `dist/pwa/*` a `app/`.
- `src/bc3.js` — parser FIEBDC-3: descarta precios, rendimientos e importes; conserva código, unidad, resumen, texto y capítulos.
- `src/engine.js` — motor determinista: búsqueda difusa + sinónimos de obra, atributos semánticos (medios, espesor, material, formato…), embudo de preguntas, partidas propias, control dimensional, herencia suelo/techo/paredes, comandos de revisión. Sin DOM: se prueba en Node.
- `src/guia.js` — **asistente guiado** (flujo del diagrama): «¿Qué vamos a medir?» → toma de datos paso a paso (estancias por recorrido de paredes con croquis, altura y huecos; fachadas con sus tipos de ventana; cubiertas planas con remonte o inclinadas por faldones con factor de pendiente; fontanería por estancia húmeda; electricidad con mínimos del REBT) → pantalla de selección de trabajos por capítulos → generación automática del estado de mediciones con las reglas de medición (suelo, techo, paredes menos huecos, rodapié menos puertas, fachada menos ventanas, desagües por diámetro según CTE DB HS 5…). Si no entiende una respuesta la vuelve a pedir con otras palabras y, al segundo intento, consulta a la IA con la pregunta en curso. Sin DOM: `node test/guia-sim.js test/g1.txt` (fachada `g2`, cubierta `g3`, instalaciones `g4`).
- `src/partidas-extra.json` — partidas que faltaban en la base y que usa el asistente; `build.js` las añade a la base al compilar (solo si el código no existe).
- `src/app.js` — interfaz Modo Obra / Luz Solar, `StorageAdapter` (IndexedDB), `VoiceAdapter`, `BillingGuard`, exportador PDF tipo Presto/Arquímedes.
- `build.js` — genera `dist/` (opcionalmente con otro BC3 base: `node build.js ruta/base.bc3`).
- `test/sim.js` + `test/s*.txt` — guiones de diálogo simulados.

## Uso
```bash
node build.js
```
```bash
npx serve dist
```
El micrófono del navegador solo funciona en **HTTPS o localhost** (no con doble clic sobre el archivo). Sin micrófono, el botón de teclado permite escribir las mismas órdenes.

## Paso a Android / iOS (Capacitor)
Copiar `dist/mediciones-voz.html` como `www/index.html` y sustituir dentro de los adaptadores:
`VoiceAdapter` → `@capacitor-community/speech-recognition` + `text-to-speech`; `BillingGuard` → compras In-App; `StorageAdapter` → mantener IndexedDB o SQLite.

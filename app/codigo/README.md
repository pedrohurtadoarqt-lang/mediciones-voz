# Mediciones por Voz — prototipo HTML local

App de **Estado de Mediciones** por diálogo de voz, 100 % local, con la base **Precios de Mallorca 2026 (COAATMCA)** embebida (1.744 partidas, sin precios).

## Archivos
- `dist/mediciones-voz.html` — **app completa en un solo archivo** (catálogo, motor, jsPDF incluidos; funciona sin conexión).
- `src/bc3.js` — parser FIEBDC-3: descarta precios, rendimientos e importes; conserva código, unidad, resumen, texto y capítulos.
- `src/engine.js` — motor determinista: búsqueda difusa + sinónimos de obra, atributos semánticos (medios, espesor, material, formato…), embudo de preguntas, partidas propias, control dimensional, herencia suelo/techo/paredes, comandos de revisión. Sin DOM: se prueba en Node.
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

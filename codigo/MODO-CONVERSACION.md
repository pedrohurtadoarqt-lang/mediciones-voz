# Modo conversación (versión 2)

La versión anterior (asistente guiado) está guardada en la rama `copia/v-guiada` y publicada, congelada, en `/guiada-04b34e20577bc410c103/`.

## Idea
El usuario cuenta la obra a su manera, como se la contaría a su encargado: por dónde empieza, medidas, huecos, trabajos y patologías, en desorden. La app toma nota, repite lo anotado y solo pregunta cuando le falta un dato imprescindible. Con «genera las mediciones» pregunta lo que falte y deja el estado de mediciones listo.

## Cómo funciona
1. Cada frase va a la IA (función `ai-interpret`, modo `conversa`; Claude y, de reserva, Gemini) con el estado actual: zonas anotadas y sus datos, trabajos anotados, lo que falta para medir, la conversación reciente y partidas candidatas de la base.
2. La IA **no calcula**: devuelve cambios en la toma de datos (zonas: planta rectangular o pared a pared, altura, huecos, cubiertas, piscinas, fontanería, electricidad) y en los trabajos (ids del catálogo de trabajos de la app, o un código de la base, o una búsqueda/partida nueva), con medidas propias solo cuando el usuario las da («reparar 1,20 m de pilar»).
3. La app aplica los cambios (`src/conversa.js`) con la misma estructura que el asistente guiado (`obra.toma`, `obra.guia.sel/resp/extra`) y recalcula el estado de mediciones con las mismas reglas (`generar` de `src/guia.js`): pintura = perímetro × altura − huecos, solado = superficie, piscinas, etc.
4. Lo que la app dice en voz alta sale de los datos aplicados (no de la IA), para que el usuario pueda comprobar los números: «Salón: 4,00 por 3,50, altura 2,60. Apunto pintura plástica en paredes…».
5. La lista «falta para medir» (alturas, plantas, huecos sin medidas, unidades que hay que preguntar) se calcula en la app; la IA la usa para preguntar solo cuando conviene. Al generar, si la IA no pregunta, la app pregunta lo primero que falte.

## Órdenes locales (sin IA)
«para», «repite», «deshaz eso / atrás» (deshace lo último anotado), «prefiero que me preguntes tú / modo guiado» (pasa al asistente guiado conservando lo anotado), «ver trabajos», y exportar/compartir/enviar como siempre.

## Requisitos
Cuenta iniciada y conexión. Sin IA, la obra nueva empieza con el asistente guiado.

## Pruebas
- `BC3=… node test/conversa-sim.js test/c1.js`: conversación desordenada con IA simulada (respuestas fijas) y estado de mediciones resultante.
- `node test/ui-conversa.js`: lo mismo en el navegador.

## Correcciones a partir de la Prueba 16
- **Cambios de idea**: «mejor que sea…», «en lugar de…», «no hace falta que sea…» sustituyen el trabajo anterior del mismo tipo (la IA lo quita; si no, la app quita el parecido anotado en los últimos turnos).
- **Una sola demolición** al «picar las paredes» (la del revestimiento que se va a poner).
- **Sanitarios** pedidos como trabajos (inodoro, lavabo, plato, mampara…) se anotan en la fontanería de la estancia, que genera aparatos, instalación y desagües.
- **Números**: la app comprueba los de la IA con los dichos en la frase (altura con un solo número; rectángulo dicho con dos números aunque la IA mande superficie y perímetro).
- **Preguntas sobre lo anotado** («¿cómo quedan las medidas del baño?», «¿qué trabajos llevamos?»): las contesta la app al momento, sin IA.
- **Voz**: lo que dice en voz alta es más corto que lo que muestra («Apunto 9 trabajos.»).

## Voz natural
Función `voz` (Gemini, texto a voz): con cuenta y conexión la app habla con una voz natural (8 voces a elegir en Ajustes). Si tarda más de 4,5 s o falla, usa la voz del móvil. El servidor elige solo el modelo de voz disponible (o `TTS_MODELO`); el estilo se puede cambiar con `TTS_ESTILO`.

## Versión 3: guiado con IA (por defecto)
La app vuelve a preguntar paso a paso, pero cada respuesta la interpreta la IA:
- **Agenda** (`agenda()` en `src/conversa.js`): el siguiente dato que falta, calculado de la toma. Por zona: interior → medidas, altura, huecos (y medidas de huecos), trabajos; fachada → ancho y alto, ventanas, trabajos; cubierta → tipo, planta o faldones, trabajos; piscina → medidas, profundidad, trabajos; fontanería → aparatos; electricidad → puntos. Después, las mediciones propias de trabajos («¿cuántos sumideros?») y «¿qué más medimos?».
- **Respuestas libres**: lo que se diga de más (otra estancia, trabajos, patologías) se anota igualmente; la agenda se salta lo que ya sabe. El foco sigue en la estancia en curso salvo que el usuario cambie de sitio («vamos a…», «pasamos a…»).
- **Atajos sin IA** para respuestas simples a la pregunta en curso: altura o profundidad con un número, «4 por 3», «ninguna», «nada», «lo elijo en pantalla», «saltar», «genera las mediciones», «una vivienda».
- **Nunca se atasca**: si una pregunta se repite sin que la respuesta aporte nada, la reformula; a la tercera la deja pendiente y sigue. «Atrás» deshace lo último y vuelve a preguntar.
- **Terminar**: «genera las mediciones» → pregunta lo imprescindible que falte → genera.
- «Te lo cuento yo» pasa al modo libre (versión 2); «pregúntame tú» vuelve al guiado.

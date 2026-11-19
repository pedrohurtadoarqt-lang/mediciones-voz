# Flujo de la medición guiada

Versión implementada del diagrama de flujo (19/11/2026). Primero se toman las medidas y después se eligen en la pantalla los trabajos. Con los trabajos elegidos, la app genera el estado de mediciones.

```mermaid
flowchart TD
  I([Inicio]) --> Q{¿Qué vamos a medir?}
  Q -->|Vivienda / reforma integral| E1
  Q -->|Estancia / habitación| E1
  Q -->|Instalaciones| IN
  Q -->|Fachada| F1
  Q -->|Cubierta| C1
  Q -->|Otra cosa| L[Medición libre con IA]

  subgraph Estancias
    E1[/¿Por qué estancia empezamos?/] --> E2[/Paredes en sentido horario + giro y lado,<br>o «4 por 3», o superficie y perímetro/]
    E2 -->|recorrido abierto| E2
    E2 --> E3[Croquis: superficie y perímetro]
    E3 --> E4[/¿Altura del suelo al techo?/]
    E4 --> E5[/¿Puertas o ventanas? medidas/]
    E5 -->|otra| E5
    E5 --> E6{¿Otra estancia?}
    E6 -->|sí| E1
  end

  subgraph Fachadas
    F1[/Fachada: nombre, ancho y alto<br>«misma que la anterior»/] -->|otra| F1
    F1 --> F2{¿Descontamos ventanas?}
    F2 -->|sí| F3[/Por fachada: ¿cuántos tipos de ventana?/]
    F3 --> F4[/Por tipo: unidades y medidas/]
    F4 --> F3
  end

  subgraph Cubiertas
    C1[/Nombre de la cubierta/] --> C2{¿Plana o inclinada?}
    C2 -->|plana| C3[/Paredes del antepecho con giros/] --> C4[Croquis + superficie] --> C5[/Remonte de la impermeabilización ≥ 20 cm/]
    C2 -->|inclinada| C6[/Faldones: ancho × largo en planta<br>pendiente opcional → factor, por defecto 1,05/]
    C5 --> C7{¿Otra cubierta?}
    C6 --> C7
    C7 -->|sí| C1
  end

  subgraph Instalaciones
    IN{¿Qué instalación?} -->|Fontanería| FO[/Estancia: baño, cocina, lavadero u otra/]
    IN -->|Electricidad| EL
    IN -->|Las dos| FO
    IN -->|Otra| L
    FO -->|baño| FB[/AF · AF+AC · ¿inodoro suspendido? → reducido/normal<br>plato o bañera → ¿mampara? · ¿bidé?/]
    FO -->|cocina| FC[/AF · AF+AC · ¿lavadora? · ¿lavavajillas?/]
    FO -->|lavadero| FL[/AF · AF+AC · ¿lavadora?/]
    FO -->|otra| FX[/¿Cuál? y qué lleva → IA ayuda a deducirlo/]
    FB & FC & FL & FX --> FO
    FO -->|ya está| EL
    EL[/¿Cuadro nuevo?/] --> EE[/Estancia: puntos de luz y tomas<br>«según normativa» = mínimos REBT ITC-BT-25/]
    EE -->|cocina| EK[/¿Placa u horno? toma 25 A/]
    EE --> EE
  end

  E6 -->|elegir trabajos| T
  F2 -->|no| T
  F3 -->|última fachada| T
  C7 -->|elegir trabajos| T
  EE -->|ya está| T
  T[[Pantalla: trabajos por capítulo<br>+ añadir partidas de la base]] --> G[Generar estado de mediciones]
  G --> P[/Preguntas que faltan: tabiques, mobiliario, fisuras…/]
  P --> FIN([Revisar · corregir hablando · PDF · Excel · BC3 · correo])
  FIN -->|medir otra zona| Q
```

## Si no entiende una respuesta
1. Vuelve a preguntar con otras palabras y un ejemplo.
2. Al segundo intento consulta a la IA, que reescribe la respuesta en el formato de la pregunta. Si la IA tampoco lo deduce, hace una pregunta corta para aclararlo.
3. Desde el tercer intento ofrece «saltar» o escribir con el teclado.
4. En cualquier momento se puede decir «atrás» (vuelve a la pregunta anterior y deshace lo anotado en ella), «ayuda», «repite», «saltar» o «cancela» (pasa a la medición libre).

## Reglas de medición
| Regla | Cálculo |
|---|---|
| Suelo / techo | superficie de la planta |
| Paredes | perímetro × altura − huecos (puertas y ventanas) |
| Rodapié | perímetro − anchos de puerta |
| Fachada | ancho × alto − ventanas (si se descuentan) |
| Sellado de carpinterías | perímetro de cada tipo de ventana × unidades |
| Vierteaguas | ancho de cada tipo de ventana × unidades |
| Cubierta plana | superficie; impermeabilización + perímetro × remonte (≥ 0,20 m) |
| Cubierta inclinada | Σ faldones ancho × largo × factor de pendiente |
| Desagües | Ø32 lavabo y bidé · Ø40 ducha, bañera, fregadero, lavadero, lavadora y lavavajillas · Ø110 inodoro (CTE DB HS 5, tabla 4.1) |
| Electricidad «según normativa» | REBT ITC-BT-25, electrificación básica, con la superficie medida de la estancia |
| Lavadora / lavavajillas | se registran en fontanería y pasan a electricidad como tomas de 16 A con toma de tierra |

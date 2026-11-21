// Prueba 16 con las respuestas reales (erróneas) de la IA: la app debe corregirlas
module.exports = [
  ['es una habitación rectangular de 3 x 3 y tiene tres metros de altura tiene una puerta de 80 por 2 metros y una ventana de 1.20 por 1,20 vamos a quitar el suelo hacer una solera y poner baldosa cerámica nueva las paredes las vamos a picar guarnecido de yeso y pintar falso techo y pintaremos',
    { zonas: [{ ambito: 'interior', nombre: 'Habitación', largo: 3, ancho: 3, altura: 3, huecos_modo: 'anadir', huecos: [{ tipo: 'puerta', uds: 1, ancho: 0.8, alto: 2 }, { tipo: 'ventana', uds: 1, ancho: 1.2, alto: 1.2 }] }],
      trabajos: [{ id: 'dem_gres', zonas: ['Habitación'] }, { codigo: 'RSB015', zonas: ['Habitación'] }, { id: 'sol_gres', zonas: ['Habitación'] }, { id: 'dem_enfosc', zonas: ['Habitación'] }, { id: 'dem_yeso', zonas: ['Habitación'] }, { id: 'rev_yeso', zonas: ['Habitación'] }, { id: 'pin_par', zonas: ['Habitación'] }, { id: 'alb_ft_pyl', zonas: ['Habitación'] }, { id: 'pin_tec', zonas: ['Habitación'] }] }],
  ['la solera no hace falta que sea con arlita puede ser una solera de hormigón normal', { trabajos: [{ codigo: 'ANS010f', zonas: ['Habitación'] }] }],
  ['me lo he pensado mejor en lugar de una solera de hormigón basta que sea una nivelación de mortero de cinco centímetros', { trabajos: [{ codigo: 'RSB010', zonas: ['Habitación'] }] }],
  ['el baño mide 250 por por 250 por 1 93', { zonas: [{ ambito: 'interior', nombre: 'Baño', largo: 2.5, ancho: 2.5, altura: 1.93 }] }],
  ['las paredes del baño de forma rectangular miden dos cincuenta por 1,93 modifícalo', { zonas: [{ ref: 'z2', ambito: 'interior', nombre: 'Baño', superficie: 4.83, perimetro: 8.86 }] }],
  ['la altura son dos veinte', { zonas: [{ ref: 'z2', ambito: 'interior', nombre: 'Baño', altura: 1.2 }] }],
  ['cómo quedan las medidas del baño', {}],
  ['y cuánto miden las paredes que hemos anotado', {}],
  ['vamos a demoler los azulejos hacer un enfoscado maestreado y alicatar con gres porcelánico', { trabajos: [{ id: 'dem_alic', zonas: ['Baño'] }, { codigo: 'RPE012', zonas: ['Baño'] }, { id: 'rev_alic', zonas: ['Baño'] }] }],
  ['también vamos a cambiar los sanitarios el lavabo el inodoro el plato de ducha y poner una mampara también falso techo', { trabajos: [{ codigo: 'IFI010', zonas: ['Baño'] }, { id: 'fon_ino', zonas: ['Baño'] }, { id: 'fon_lavabo', zonas: ['Baño'] }, { id: 'fon_plato', zonas: ['Baño'] }, { id: 'fon_mampara', zonas: ['Baño'] }, { id: 'alb_ft_pyl', zonas: ['Baño'] }] }],
  ['vamos a sacar ya las mediciones', { accion: 'generar' }]
];

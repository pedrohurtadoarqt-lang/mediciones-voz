// Modo guiado con IA: la app pregunta, el usuario contesta en desorden, corrige y vuelve atrás
module.exports = [
  ['una vivienda', null],
  ['empezamos por el salón que tiene 4 por 3 y medio', { zonas: [{ ambito: 'interior', nombre: 'Salón', largo: 4, ancho: 3.5 }] }],
  ['dos sesenta', null],
  ['una puerta de 82 y una ventana de 1,20 por 1,10 y por cierto la cocina mide 3 por 2,40', { zonas: [{ ref: 'z1', ambito: 'interior', nombre: 'Salón', huecos_modo: 'anadir', huecos: [{ tipo: 'puerta', uds: 1, ancho: 0.82, alto: null }, { tipo: 'ventana', uds: 1, ancho: 1.2, alto: 1.1 }] }, { ambito: 'interior', nombre: 'Cocina', largo: 3, ancho: 2.4 }] }],
  ['quitar el gres poner porcelánico y pintar paredes y techo', { trabajos: [{ id: 'dem_gres', zonas: ['Salón'] }, { id: 'sol_gres', zonas: ['Salón'] }, { id: 'pin_par', zonas: ['Salón'] }, { id: 'pin_tec', zonas: ['Salón'] }] }],
  ['dos cuarenta', null],
  ['atrás', null],
  ['dos cincuenta', null],
  ['no tiene', null],
  ['alicatar las paredes y en el baño plato de ducha inodoro y lavabo', { trabajos: [{ id: 'rev_alic', zonas: ['Cocina'] }], zonas: [{ ambito: 'fontaneria', nombre: 'Baño', fon_tipo: 'bano', inodoro: 'normal', ducha: 'plato' }] }],
  ['otra estancia', { zonas: [] }],
  ['genera las mediciones', null],
  ['dos por uno ochenta', null],
  ['dos cincuenta', null],
  ['ninguna', null],
  ['pintar', { trabajos: [{ id: 'pin_par', zonas: ['Baño'] }] }]
];

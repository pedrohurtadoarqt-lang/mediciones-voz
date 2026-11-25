// Prueba 25 en la guiada con IA: «no quiero descontarlas» (la IA no lo marca) y huecos repetidos que la IA manda como nuevos
const H = [{ tipo: 'puerta', uds: 1, ancho: 0.7, alto: 2 }, { tipo: 'ventana', uds: 1, ancho: 1, alto: 1 }];
module.exports = [
  ['dormitorio uno', { zonas: [{ ambito: 'interior', nombre: 'Dormitorio 1' }] }],
  ['tres metros giro a la derecha tres metros giro a la derecha tres metros giro a la derecha tres metros', { zonas: [{ ambito: 'interior', nombre: 'Dormitorio 1', largo: 3, ancho: 3 }] }],
  ['dos cincuenta', { zonas: [{ ambito: 'interior', nombre: 'Dormitorio 1', altura: 2.5 }] }],
  ['tiene una puerta de setenta por dos metros y una ventana de un metro por un metro no quiero descontarlas', { zonas: [{ ambito: 'interior', nombre: 'Dormitorio 1', huecos_modo: 'anadir', huecos: H }] }],
  ['vale hay una puerta de 70 por dos metros y una ventana de un metro por un metro', { zonas: [{ ambito: 'interior', nombre: 'Dormitorio 1', huecos_modo: 'anadir', huecos: H }] }],
  ['hay que pintar paredes y techo', { trabajos: [{ id: 'pin_par', zonas: ['Dormitorio 1'] }, { id: 'pin_tec', zonas: ['Dormitorio 1'] }] }],
  ['genera las mediciones', { accion: 'generar' }]
];

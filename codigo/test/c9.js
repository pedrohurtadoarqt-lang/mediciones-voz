// «En la pintura no descuentes los huecos»: solo esa partida; el rodapié de la misma estancia sigue descontando la puerta
module.exports = [
  ['dormitorio de 3 por 3, altura 2,50, una puerta de 0,80 por 2 y una ventana de 1,20 por 1,20', { zonas: [{ ambito: 'interior', nombre: 'Dormitorio', largo: 3, ancho: 3, altura: 2.5, huecos_modo: 'anadir', huecos: [{ tipo: 'puerta', uds: 1, ancho: 0.8, alto: 2 }, { tipo: 'ventana', uds: 1, ancho: 1.2, alto: 1.2 }] }] }],
  ['pintar paredes y poner rodapié de madera', { trabajos: [{ id: 'pin_par', zonas: ['Dormitorio'] }, { buscar: 'Rodapié de madera', unidad: 'm', zonas: ['Dormitorio'] }] }],
  ['en la pintura no descuentes los huecos', { zonas: [{ ambito: 'interior', nombre: 'Dormitorio', descontar: 'no' }] }],
  ['genera las mediciones', { accion: 'generar' }]
];

// Prueba 26: papel vinílico en una sola pared; correcciones sobre esa partida
const H = [{ tipo: 'ventana', uds: 1, ancho: 2, alto: 1 }, { tipo: 'puerta', uds: 2, ancho: 0.8, alto: 2 }];
const VIN = 'Revestimiento ligero con papel de vinilo';
module.exports = [
  ['salón', { zonas: [{ ambito: 'interior', nombre: 'Salón' }] }],
  ['mide cuatro metros por tres metros', { zonas: [{ ambito: 'interior', nombre: 'Salón', largo: 4, ancho: 3 }] }],
  ['una ventana que mide dos metros de ancho y un metro de alto y dos puertas de 80 por 2 metros', { zonas: [{ ambito: 'interior', nombre: 'Salón', huecos_modo: 'anadir', huecos: H }] }],
  ['dos cincuenta', { zonas: [{ ambito: 'interior', nombre: 'Salón', altura: 2.5 }] }],
  ['en el salón tenemos que pintar y cambiar el falso techo', { trabajos: [{ id: 'pin_par', zonas: ['Salón'] }, { id: 'pin_tec', zonas: ['Salón'] }] }],
  ['quiero añadir un trabajo, en una de las paredes quiero poner un papel vinílico', { trabajos: [{ buscar: VIN, unidad: 'm2', zonas: ['Salón'] }] }],
  ['es en la pared norte que es la que mide 4 metros, la altura eran 250', { trabajos: [{ buscar: VIN, unidad: 'm2', zonas: ['Salón'], medidas: [{ zona: 'Salón', comentario: 'Pared norte', largo: 4, alto: 2.5 }] }] }],
  ['hay que quitar el revestimiento vinílico de las cuatro paredes y solo hay que dejar uno, el de la pared norte', { trabajos: [{ id: 'dem_yeso', zonas: ['Salón'] }] }],
  ['en la partida del vinilo no quiero descontar puertas ni ventanas', { zonas: [{ ambito: 'interior', nombre: 'Salón', descontar: 'no', huecos_modo: 'reemplazar', huecos: [] }] }],
  ['en el salón hay que poner papel vinílico en una sola pared que mide 4 por 2 y medio y no tiene ni puerta ni ventana', { zonas: [{ ambito: 'interior', nombre: 'Salón', huecos_modo: 'reemplazar', huecos: [] }], trabajos: [{ buscar: VIN, unidad: 'm2', zonas: ['Salón'], medidas: [{ zona: 'Salón', comentario: 'Pared', largo: 4, alto: 2.5 }] }] }],
  ['genera las mediciones', { accion: 'generar' }]
];

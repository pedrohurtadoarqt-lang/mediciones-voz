// Conversación desordenada típica: el usuario cuenta la obra y la app pregunta lo que falta
module.exports = [
  ['empezamos por el salón que mide cuatro por tres y medio y tiene dos sesenta de alto', { zonas: [{ ambito: 'interior', nombre: 'Salón', largo: 4, ancho: 3.5, altura: 2.6 }] }],
  ['aquí hay que quitar el gres y poner porcelánico y pintar paredes y techo', { trabajos: [{ id: 'dem_gres', zonas: ['Salón'] }, { id: 'sol_gres', zonas: ['Salón'] }, { id: 'pin_par', zonas: ['Salón'] }, { id: 'pin_tec', zonas: ['Salón'] }] }],
  ['tiene una puerta de 82 y una ventana de uno veinte por uno diez', { zonas: [{ ref: 'z1', ambito: 'interior', nombre: 'Salón', huecos_modo: 'anadir', huecos: [{ tipo: 'puerta', uds: 1, ancho: 0.82, alto: null }, { tipo: 'ventana', uds: 1, ancho: 1.2, alto: 1.1 }] }] }],
  ['en la cocina que es de tres por dos cuarenta hay que alicatar y cambiar el suelo', { zonas: [{ ambito: 'interior', nombre: 'Cocina', largo: 3, ancho: 2.4 }], trabajos: [{ id: 'rev_alic', zonas: ['Cocina'] }, { id: 'dem_gres', zonas: ['Cocina'] }, { id: 'sol_gres', zonas: ['Cocina'] }] }],
  ['ah y en el baño plato de ducha con mampara inodoro suspendido y lavabo', { zonas: [{ ambito: 'interior', nombre: 'Baño' }, { ambito: 'fontaneria', nombre: 'Baño', fon_tipo: 'bano', inodoro: 'suspendido', ducha: 'plato', mampara: 'si' }] }],
  ['en el pasillo hay un pilar con los hierros oxidados habrá que reparar un metro veinte', { zonas: [{ ambito: 'interior', nombre: 'Pasillo' }], trabajos: [{ codigo: 'EHY095', zonas: ['Pasillo'], medidas: [{ zona: 'Pasillo', comentario: 'Pilar con armaduras oxidadas', uds: 1, largo: 1.2, ancho: null, alto: null }] }] }],
  ['toda la casa hay que pintarla', { trabajos: [{ id: 'pin_par', zonas: [] }, { id: 'pin_tec', zonas: [] }] }],
  ['ya está genera las mediciones', { accion: 'generar', pregunta: '¿Qué altura tiene la cocina?' }],
  ['dos sesenta igual que el salón', { zonas: [{ ref: 'z2', ambito: 'interior', nombre: 'Cocina', altura: 2.6 }], accion: 'generar' }],
  ['el baño es de dos por uno ochenta y dos cincuenta de alto', { zonas: [{ ref: 'z3', ambito: 'interior', nombre: 'Baño', largo: 2, ancho: 1.8, altura: 2.5 }] }],
  ['el pasillo cuatro por uno y la misma altura que el salón', { zonas: [{ ref: 'z5', ambito: 'interior', nombre: 'Pasillo', largo: 4, ancho: 1, altura: 2.6 }], accion: 'generar' }],
  ['no espera el salón era de cuatro veinte no de cuatro', { zonas: [{ ref: 'z1', ambito: 'interior', nombre: 'Salón', largo: 4.2, ancho: 3.5 }] }],
  ['deshaz eso', {}]
];

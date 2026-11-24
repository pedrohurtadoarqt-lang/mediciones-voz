// Prueba 23: dice «baldosas hidráulicas» y la IA apunta demolición de gres; al corregir, la IA añade un SOLADO hidráulico
module.exports = [
  ['Salón', { zonas: [{ ambito: 'interior', nombre: 'Salón' }] }],
  ['cuatro por cuatro', { zonas: [{ ambito: 'interior', nombre: 'Salón', largo: 4, ancho: 4 }] }],
  ['tres metros', { zonas: [{ ambito: 'interior', nombre: 'Salón', altura: 3 }] }],
  ['pues en el capítulo de demoliciones vamos a quitar el solado que son baldosas hidráulicas vamos a quitar los rodapiés', { trabajos: [{ id: 'dem_gres', zonas: ['Salón'] }, { id: 'dem_rodapie', zonas: ['Salón'] }] }],
  ['la demolición del solado ha puesto solado de gres y es solado de baldosa hidráulica deberías de coger la partida y modificar este aspecto', { trabajos: [{ buscar: 'solado de baldosas hidráulicas', unidad: 'm2', zonas: ['Salón'] }] }],
  ['en el suelo vamos a hacer una base para embaldosar y luego embaldosar con gres porcelánico', { trabajos: [{ id: 'sol_base', zonas: ['Salón'] }, { id: 'sol_gres', zonas: ['Salón'] }] }],
  ['Generar mediciones', { accion: 'generar' }]
];

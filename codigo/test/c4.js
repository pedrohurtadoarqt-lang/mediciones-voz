// Prueba 19 con respuestas erróneas de la IA: la app debe corregirlas (recorrido, rehacer planta, quitar sin pedirlo, partidas absurdas)
module.exports = [
  ['vamos a medir el dormitorio número 2', { zonas: [{ ambito: 'interior', nombre: 'dormitorio número 2' }] }],
  ['dos metros giro a la derecha un metro giro a la izquierda un metro giro a la derecha dos metros giro a la derecha tres metros giro a la derecha tres metros', { zonas: [{ ref: 'z1', ambito: 'interior', nombre: 'Dormitorio 2', tramos: [{ largo: 2, giro: 'derecha', angulo: 90 }, { largo: 7, giro: 'derecha', angulo: 90 }, { largo: 2, giro: 'derecha', angulo: 90 }, { largo: 7, giro: '', angulo: 90 }] }] }],
  ['está mal he dicho', null],
  ['dos metros a la derecha un metro a la izquierda un metro a la derecha dos metros a la derecha tres metros a la derecha tres metros', { zonas: [{ ref: 'z1', ambito: 'interior', nombre: 'Dormitorio 2', tramos: [{ largo: 2, giro: 'derecha', angulo: 90 }, { largo: 1, giro: 'izquierda', angulo: 90 }, { largo: 1, giro: 'derecha', angulo: 90 }, { largo: 2, giro: 'derecha', angulo: 90 }, { largo: 3, giro: 'derecha', angulo: 90 }, { largo: 3, giro: '', angulo: 90 }] }] }],
  ['dos cincuenta', null],
  ['los trabajos son demoler falsos techos picar el guarnecido de yeso levantar el suelo de baldosa luego volveremos a rehacer todo nuevo y pintaremos tenemos una puerta de 80 por 2 metros y una ventana de 1,20 por 1,20',
    { zonas: [{ ref: 'z1', ambito: 'interior', nombre: 'Dormitorio 2', huecos_modo: 'anadir', huecos: [{ tipo: 'puerta', uds: 1, ancho: 0.8, alto: 2 }, { tipo: 'ventana', uds: 1, ancho: 1.2, alto: 1.2 }] }],
      trabajos: [{ id: 'dem_ftecho', zonas: ['Dormitorio 2'] }, { id: 'dem_yeso', zonas: ['Dormitorio 2'] }, { id: 'dem_gres', zonas: ['Dormitorio 2'] }, { id: 'alb_ft_pyl', zonas: ['Dormitorio 2'] }, { id: 'rev_yeso', zonas: ['Dormitorio 2'] }, { id: 'sol_gres', zonas: ['Dormitorio 2'] }, { id: 'pin_par', zonas: ['Dormitorio 2'] }, { id: 'pin_tec', zonas: ['Dormitorio 2'] }] }],
  ['genera las mediciones', null],
  ['faltan trabajos hay que hacer el falso techo dar yeso a las paredes y además hay que hacer una base para embaldosar',
    { trabajos: [{ id: 'dem_ftecho', zonas: ['Dormitorio 2'], quitar: true }, { id: 'dem_gres', zonas: ['Dormitorio 2'], quitar: true }, { buscar: 'Azotea catalana embaldosado', unidad: 'm2', zonas: ['Dormitorio 2'] }, { buscar: 'Base de mortero para nivelar y embaldosar', unidad: 'm2', zonas: ['Dormitorio 2'] }, { id: 'rev_yeso', zonas: ['Dormitorio 2'] }] }],
  ['genera las mediciones', null]
];

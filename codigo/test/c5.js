// Prueba 21 (nota de audio): la respuesta que da la IA a la transcripción, aplicada de una vez
module.exports = { visita: true, transcripcion: 'Coladuría 4 por 3 … cocina 3 por 3 … horno, microondas, termo, nevera, descalcificador …', respuesta: {
  zonas: [
    { ambito: 'interior', nombre: 'Coladuría', tramos: [{ largo: 4, giro: 'derecha', angulo: 90 }, { largo: 3, giro: 'derecha', angulo: 90 }, { largo: 4, giro: 'derecha', angulo: 90 }, { largo: 3, giro: 'derecha', angulo: 90 }], altura: 2.2, huecos_modo: 'anadir', huecos: [{ tipo: 'puerta', uds: 1, ancho: 0.7, alto: 2 }, { tipo: 'puerta', uds: 1, ancho: 0.7, alto: 2 }, { tipo: 'ventana', uds: 1, ancho: 1, alto: 1 }, { tipo: 'ventana', uds: 1, ancho: 1.2, alto: 1 }] },
    { ambito: 'interior', nombre: 'Aseo', largo: 3, ancho: 1.4, huecos_modo: 'anadir', huecos: [{ tipo: 'puerta', uds: 1, ancho: 0.72, alto: 2 }, { tipo: 'ventana', uds: 1, ancho: 0.8, alto: 1 }] },
    { ambito: 'fontaneria', nombre: 'Aseo', fon_tipo: 'bano', inodoro: 'normal' },
    { ambito: 'fontaneria', nombre: 'Coladuría', lavadora: 'si' },
    { ambito: 'interior', nombre: 'Cocina', largo: 3, ancho: 3, altura: 2.7 },
    { ambito: 'fontaneria', nombre: 'Cocina', fon_tipo: 'cocina', agua_fria_caliente: 1, lavavajillas: 'si' },
    { ambito: 'electricidad', nombre: 'Cocina', segun_norma: 'si', equipos: ['horno', 'microondas', 'termo', 'nevera', 'lavavajillas'] }],
  trabajos: [
    { id: 'dem_mob_coc', zonas: ['Cocina'], medidas: [{ zona: 'Cocina', comentario: 'Muebles de cocina', largo: 6 }] }, { id: 'fon_dem', zonas: ['Cocina'] }, { id: 'ele_dem', zonas: ['Cocina'] },
    { id: 'fon_termo', zonas: ['Cocina'] }, { id: 'fon_descal', zonas: ['Cocina'] },
    { id: 'alb_ft_pyl', zonas: ['Coladuría', 'Cocina'] }, { id: 'dem_gres', zonas: ['Coladuría', 'Cocina'] }, { id: 'sol_base', zonas: ['Coladuría', 'Cocina'] }, { id: 'sol_gres', zonas: ['Coladuría', 'Cocina'] },
    { id: 'dem_ftecho', zonas: ['Cocina'] }, { id: 'dem_alic', zonas: ['Cocina'] }, { id: 'rev_enf_alic', zonas: ['Cocina'] }, { id: 'rev_alic', zonas: ['Cocina'] }, { id: 'pin_tec', zonas: ['Coladuría', 'Cocina'] }] } };

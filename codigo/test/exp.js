const B=require('../src/bc3.js'),E=require('../src/engine.js'),fs=require('fs');
global.Engine=E; const X=require('../src/export.js');
const cat=E.prepareCatalog(B.parseBC3(fs.readFileSync(process.env.BC3)));
const io={say(){},user(){},save(){},render(){},getCatalog:()=>cat,exportPdf(){},confirmPick:()=>false};
const d=new E.Dialog(io); const obra={id:'t',titulo:'Reforma Calle Mayor 14',cliente:'Ana P.',ubicacion:'Palma',partidas:[],estancias:[]}; d.setObra(obra);
['vivienda','cocina','picado de azulejos','pared frontal 3,40 por 2,50','descuenta puerta de 0,82 por 2,03','siguiente partida','solado de gres porcelánico','la primera','3,20 por 2,60','pasamos al baño','enchufes','la primera','3','eliminar papel pintado','crear nueva','m2','Eliminar papel pintado','4,20','3'].forEach(t=>d.handle(t));
fs.writeFileSync('test/out.bc3', X.buildBC3(obra)); fs.writeFileSync('test/out.xlsx', X.buildXLSX(obra));
console.log(E.obraChapters(obra).map(c=>c.codigo+' '+c.titulo+': '+c.partidas.map(p=>p.codigo+' '+p.ref+' '+p.lineas.length).join(', ')).join('\n'));

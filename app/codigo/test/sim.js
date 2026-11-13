const B=require('../src/bc3.js'), E=require('../src/engine.js'), fs=require('fs');
const cat=E.prepareCatalog(B.parseBC3(fs.readFileSync(process.env.BC3),'Palma'));
const out=[];
const io={say:(t,ch)=>out.push('  APP: '+t+(ch&&ch.length?'\n       ['+ch.map(c=>c.label).join(' | ')+']':'')),user:t=>out.push('USER: '+t),save(){},render(){},getCatalog:()=>cat,exportPdf(){}};
const d=new E.Dialog(io);
const obra={id:'t',titulo:'Prueba',partidas:[],estancias:[]};
d.setObra(obra);
const script=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean);
for(const l of script){ if(l.startsWith('#chip ')){const i=+l.slice(6);const ch=d.lastPrompt.chips[i];d.handle(ch);} else d.handle(l);}
console.log(out.join('\n'));
const caps=E.obraChapters(obra);
for(const c of caps){console.log(c.codigo,c.titulo);for(const p of c.partidas){console.log(' ',p.codigo,p.ref,E.unitLabel(p.u),p.r,'=',E.totalOf(p));for(const l of p.lineas)console.log('     ',l.est,'|',l.com,'|',l.uds,l.l,l.a,l.h,'=',E.parcial(l));}}

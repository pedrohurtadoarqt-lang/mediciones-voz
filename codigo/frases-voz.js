// Frases fijas que dice la app (las completas, sin partes variables), para dejarlas preparadas en la caché de voz.
const fs = require('fs'), path = require('path');
module.exports = function frasesVoz() {
  const set = new Set();
  for (const f of ['conversa.js', 'guia.js', 'engine.js', 'app.js']) {
    const src = fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
    const re = /'((?:[^'\\\n]|\\.){4,220})'/g; let m;
    while ((m = re.exec(src))) {
      const t = m[1].replace(/\\'/g, "'"), antes = src.slice(Math.max(0, m.index - 3), m.index), despues = src.slice(re.lastIndex, re.lastIndex + 3);
      if (/\+\s*$/.test(antes) || /^\s*\+/.test(despues)) continue;            // trozo de una frase compuesta
      if (!/^[¿¡A-ZÁÉÍÓÚÑ]/.test(t) || !/[.?!]$/.test(t)) continue;           // frase completa
      if (/[{}<>=|\\$]|https?:|\b(true|false|null)\b/.test(t) || t.split(' ').length < 2 && !/[?!]$/.test(t)) continue;
      if (/^(Error|No se pudo|No he podido|Este navegador|Para leer|Sin conexión|Has llegado|Borra|Revisa|Entra en tu cuenta|Termina|Estás grabando|El generador|La obra no|Abre primero|No hay)/.test(t)) continue; // avisos en pantalla
      set.add(t.replace(/(\d+),00\b/g, '$1').replace(/«|»/g, ''));
    }
  }
  return [...set];
};
if (require.main === module) { const l = module.exports(); console.log(l.length); console.log(l.slice(0, 40).join('\n')); }

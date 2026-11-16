// Mínimo de Engine que necesita ai.js en el servidor (Deno).
const UNIT = { ud: 'ud', m: 'm', m2: 'm²', m3: 'm³', kg: 'kg', t: 't', l: 'l' };
globalThis.Engine = {
  unitLabel: (u) => UNIT[u] || u,
  words: (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
};

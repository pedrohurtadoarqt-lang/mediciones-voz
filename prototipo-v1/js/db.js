/* Envoltorio mínimo de IndexedDB (sin dependencias). */
(function (global) {
  'use strict';
  var DB_NAME = 'medicion-voz';
  var VERSION = 1;
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('partidas')) db.createObjectStore('partidas', { keyPath: 'code' });
        if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters', { keyPath: 'code' });
        if (!db.objectStoreNames.contains('visitas')) db.createObjectStore('visitas', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('lineas')) {
          var s = db.createObjectStore('lineas', { keyPath: 'id' });
          s.createIndex('visita', 'visitaId');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }

  function tx(stores, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(stores, mode);
        var result;
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
        result = fn.apply(null, [].concat(stores).map(function (s) { return t.objectStore(s); }));
        if (result && typeof result.then === 'function') result.then(function (v) { result = v; });
      });
    });
  }

  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  var DB = {
    get: function (store, key) { return open().then(function (db) { return reqP(db.transaction(store).objectStore(store).get(key)); }); },
    getAll: function (store) { return open().then(function (db) { return reqP(db.transaction(store).objectStore(store).getAll()); }); },
    put: function (store, value, key) { return tx(store, 'readwrite', function (s) { key === undefined ? s.put(value) : s.put(value, key); }); },
    del: function (store, key) { return tx(store, 'readwrite', function (s) { s.delete(key); }); },
    byIndex: function (store, index, value) {
      return open().then(function (db) { return reqP(db.transaction(store).objectStore(store).index(index).getAll(value)); });
    },
    kvGet: function (k) { return DB.get('kv', k); },
    kvSet: function (k, v) { return DB.put('kv', v, k); },
    replaceCatalog: function (parsed) {
      return tx(['partidas', 'chapters', 'kv'], 'readwrite', function (p, c, kv) {
        p.clear(); c.clear();
        parsed.partidas.forEach(function (x) { p.put(x); });
        parsed.chapters.forEach(function (x) { c.put(x); });
        kv.put(parsed.meta, 'catalogMeta');
      });
    },
    deleteVisita: function (id) {
      return DB.byIndex('lineas', 'visita', id).then(function (lines) {
        return tx(['lineas', 'visitas'], 'readwrite', function (l, v) {
          lines.forEach(function (x) { l.delete(x.id); });
          v.delete(id);
        });
      });
    },
    putMany: function (store, arr) { return tx(store, 'readwrite', function (s) { arr.forEach(function (x) { s.put(x); }); }); }
  };
  global.DB = DB;
})(window);

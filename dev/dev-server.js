// Servidor de DESARROLLO local: usa pg-mem (una base de datos Postgres
// emulada en memoria) para poder correr y probar toda la app sin necesitar
// todavía un Postgres real. Esto NO se usa en producción — ahí server/index.js
// se conecta a DATABASE_URL de verdad (Neon, Render, etc.) tal cual.
const { newDb } = require('pg-mem');

const memDb = newDb({ autoCreateForeignKeyIndices: true });
const pgAdapter = memDb.adapters.createPg();

// Reemplaza el módulo 'pg' en el cache de require ANTES de que server/db.js lo pida.
const pgPath = require.resolve('pg');
require.cache[pgPath] = {
  id: pgPath,
  filename: pgPath,
  loaded: true,
  exports: pgAdapter,
};

process.env.DATABASE_URL = 'postgres://localhost/dev-memoria';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-no-usar-en-produccion';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'leal2026';
process.env.PORT = process.env.PORT || '3000';

console.log('== Modo desarrollo: base de datos en memoria (pg-mem), los datos NO persisten ==');
require('../server/index.js');

# Leal Bets

Casa de apuestas con fichas virtuales para el grupo, sobre el torneo amateur
(Copa del Rey, Primera A). Versión con backend y base de datos propia —
reemplaza al prototipo hecho como página HTML suelta (`leal-bets.html`,
`leal-bets-completo.md`), preservando toda su lógica (motor de cuotas Elo +
Poisson, cuotas dinámicas de jugador para Leal FC, apuestas combinadas,
liquidación, cash out, etc.)

## Qué cambia respecto al prototipo

- **Backend real** (Node.js + Express) en vez de `window.storage`.
- **Base de datos Postgres** en vez de un storage compartido ligado al link.
- **Contraseñas con bcrypt** (hasheadas), nunca en texto plano.
- **Sesión con JWT**: el usuario nunca ve ni guarda la contraseña de otro, y
  la contraseña de admin nunca viaja al navegador ni queda hardcodeada en el
  HTML (antes estaba a la vista en el código fuente del cliente).
- **Cuotas calculadas y validadas en el servidor**: el cliente nunca decide
  a qué cuota se cierra una apuesta.
- **Tiempo real con WebSockets** (Socket.IO) en vez de refrescar cada 7
  segundos: cuando alguien aputesta o el admin carga un resultado, todos los
  dispositivos conectados se actualizan al instante.

Todas las fórmulas (Elo, Poisson, cuotas de jugador dinámicas, liquidación de
combinadas, anulación por "no jugó", cash out) están portadas tal cual desde
el prototipo — ver [`leal-bets-completo.md`](leal-bets-completo.md) para el
detalle de cada una.

## Estructura

```
server/
  index.js       servidor HTTP + Socket.IO + rutas
  db.js          conexión a Postgres + esquema + seed inicial
  auth.js        JWT, bcrypt, middlewares de autenticación
  oddsEngine.js  motor de cuotas (Elo, Poisson, cuotas de jugador)
  lealProps.js   lista base de cuotas de jugadores de Leal FC + fixture semilla
  state.js       lectura de estado público + recálculo de props de Leal
  routes/        auth, state, bets, admin
public/
  index.html, css/style.css, js/app.js   frontend (mismo diseño del prototipo)
dev/
  dev-server.js  levanta el server con una base Postgres emulada en memoria
                 (pg-mem), útil para probar sin instalar Postgres
  smoke-test.js  prueba end-to-end de toda la lógica de negocio
```

## Desarrollo local

Sin instalar Postgres (rápido, para probar):

```bash
npm install
node dev/dev-server.js
```

Abrí http://localhost:3000 — los datos viven en memoria y se pierden al
reiniciar (es solo para probar).

Con un Postgres real:

```bash
cp .env.example .env
# completá DATABASE_URL, JWT_SECRET y ADMIN_PASSWORD en .env
npm install
npm start
```

Para correr la prueba de humo end-to-end (con el server de memoria ya
levantado en otra terminal):

```bash
node dev/smoke-test.js
```

## Desplegar a internet (gratis)

Se necesitan dos cosas gratuitas, y **tenés que crearlas vos** (por política
no puedo crear cuentas en tu nombre) — es rápido, con tu cuenta de GitHub:

1. **Base de datos — [Neon](https://neon.tech)** (Postgres gratis, no
   expira): creá un proyecto, y copiá el "Connection string" (algo como
   `postgres://usuario:password@ep-algo.neon.tech/neondb?sslmode=require`).

2. **Subí este código a GitHub**: creá un repo nuevo (puede ser privado) y
   pusheá esta carpeta.

3. **Servidor — [Render](https://render.com)** (gratis, login con GitHub):
   "New" → "Blueprint" → elegí el repo → Render va a detectar
   `render.yaml` automáticamente. Antes de confirmar el deploy, completá:
   - `DATABASE_URL`: el connection string de Neon del paso 1.
   - `ADMIN_PASSWORD`: la contraseña que van a usar para entrar al panel de
     administrador (equipos, partidos, resultados).
   - `JWT_SECRET` se genera solo.

   Con eso, Render te da una URL pública (tipo
   `https://leal-bets.onrender.com`) — esa es la que compartís con el grupo.

El plan free de Render "duerme" el servicio tras ~15 min sin uso y tarda unos
segundos en despertar con la primera visita después de eso; para un grupo de
amigos no debería ser un problema.

### Alternativas

El proyecto es un Node.js + Postgres estándar, así que también corre en
Railway, Fly.io, o cualquier VPS — solo necesita las tres variables de
entorno de `.env.example` y `npm start`. Incluye un `Dockerfile` por si el
hosting elegido lo pide.

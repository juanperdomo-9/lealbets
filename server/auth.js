const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('Falta la variable de entorno JWT_SECRET.');
  process.exit(1);
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('Falta la variable de entorno ADMIN_PASSWORD.');
  process.exit(1);
}

function signUserToken(name) {
  return jwt.sign({ sub: name, role: 'user' }, JWT_SECRET, { expiresIn: '180d' });
}
function signAdminToken() {
  return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
}

function verify(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function getBearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

// Requiere un usuario logueado; deja req.userName seteado.
function requireAuth(req, res, next) {
  const token = getBearer(req);
  const payload = token && verify(token);
  if (!payload || payload.role !== 'user' || !payload.sub) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  req.userName = payload.sub;
  next();
}

// Requiere el token de admin (obtenido con la contraseña de administrador).
function requireAdmin(req, res, next) {
  const token = getBearer(req);
  const payload = token && verify(token);
  if (!payload || payload.role !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }
  next();
}

module.exports = {
  ADMIN_PASSWORD,
  signUserToken,
  signAdminToken,
  requireAuth,
  requireAdmin,
};

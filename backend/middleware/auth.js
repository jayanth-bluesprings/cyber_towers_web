function getConfiguredApiKey() {
  const apiKey = String(process.env.API_KEY || '').trim();
  return apiKey || null;
}

function extractApiKey(req) {
  const headerKey = req.get('x-api-key');
  if (headerKey) return String(headerKey).trim();

  const authHeader = req.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  if (req.query && req.query.apiKey) {
    return String(req.query.apiKey).trim();
  }

  return null;
}

function isAuthorizedApiKey(value) {
  const configured = getConfiguredApiKey();
  if (!configured) return true;
  return value === configured;
}

function requireApiKey(req, res, next) {
  if (isAuthorizedApiKey(extractApiKey(req))) {
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Unauthorized',
  });
}

module.exports = {
  extractApiKey,
  getConfiguredApiKey,
  isAuthorizedApiKey,
  requireApiKey,
};

// Only explicitly controlled NABD origins may initiate browser state-changing requests.
// Compare serialized origins, not suffixes, user-controlled X-Forwarded-Host, or Referer.
const productionOrigins = Object.freeze([
  'https://nabdtrading.com',
  'https://www.nabdtrading.com',
  'https://gold-pulse-ai.onrender.com'
]);
export function trustedBrowserOrigin(origin, publicBase) {
  if (typeof origin !== 'string' || !origin) return false;
  try {
    const parsed = new URL(origin);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin ||
        parsed.username || parsed.password || parsed.pathname !== '/' ||
        parsed.search || parsed.hash) return false;
    const configured = publicBase ? new URL(publicBase).origin : null;
    return parsed.origin === configured || productionOrigins.includes(parsed.origin);
  } catch {return false;}
}

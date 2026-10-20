// Only the site owner edits this target. Query parameters never select a host.
export const TARGET_ORIGIN = 'https://husil.world';

export function resolveEntry(search) {
  const params = new URLSearchParams(search);
  const codes = params.getAll('code');
  const code = codes[0] ?? '';
  const valid = codes.length === 1 && (
    /^[a-z0-9]{3,32}$/i.test(code) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(code)
  );
  return {
    preview: params.get('preview') === '1',
    destination: valid ? new URL(`/${code}`, TARGET_ORIGIN).href : null,
  };
}

export function mountEntry(doc, location) {
  const entry = resolveEntry(location.search);
  const title = doc.getElementById('title');
  if (!entry.destination) {
    title.textContent = '访问链接不完整';
    return;
  }
  if (entry.preview) return;
  location.replace(entry.destination);
}

if (typeof document !== 'undefined') mountEntry(document, window.location);

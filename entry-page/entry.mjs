// Only the site owner edits this target. Query parameters never select a host.
export const TARGET_ORIGIN = 'https://sjeeqw.fit';

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
  const description = doc.getElementById('description');
  const status = doc.getElementById('status');
  doc.getElementById('preview').hidden = !entry.preview;
  if (!entry.destination) {
    title.textContent = '访问链接不完整';
    description.textContent = '邀请码缺失或格式不正确，请返回原页面重新打开链接。';
    status.textContent = '请勿删除链接中的 code 参数。';
    return;
  }
  title.textContent = '正在进入网站';
  description.textContent = '正在自动打开页面，无需操作。';
  doc.getElementById('destination-box').hidden = false;
  doc.getElementById('destination').textContent = new URL(entry.destination).host;
  if (entry.preview) {
    title.textContent = '自动跳转演示';
    status.textContent = `页面加载后立即前往：${entry.destination}`;
    return;
  }
  status.textContent = '正在跳转…';
  location.replace(entry.destination);
}

if (typeof document !== 'undefined') mountEntry(document, window.location);

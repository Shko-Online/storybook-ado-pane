// Static import chain, as bundlers emit it.
import { fromA } from './mod-a.js';

const results = document.getElementById('results');
const report = (name, ok, detail = '') => {
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  li.dataset.check = name;
  li.textContent = `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`;
  results.append(li);
};
const check = async (name, run) => {
  try {
    const detail = await run();
    report(name, true, typeof detail === 'string' ? detail : '');
  } catch (err) {
    report(name, false, String(err && err.message ? err.message : err));
  }
};
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const imageLoaded = (id) =>
  new Promise((resolve, reject) => {
    const img = document.getElementById(id);
    const done = () => (img.naturalWidth > 0 ? resolve() : reject(new Error('did not load')));
    if (img.complete) done();
    else {
      img.addEventListener('load', done);
      img.addEventListener('error', () => reject(new Error('did not load')));
    }
  });

await check('static module imports', () => expect(fromA() === 'a+b', `got ${fromA()}`));
await check('dynamic import', async () => {
  const lazy = await import('./nested/lazy.js');
  expect(lazy.default === 'lazy+b', `got ${lazy.default}`);
});
await check('query string is kept', () => expect(new URLSearchParams(location.search).has('id') || location.search.includes('opened'), location.search));
await check('fetch relative json', async () => {
  const res = await fetch('data.json');
  expect(res.ok, `status ${res.status}`);
  expect(res.headers.get('content-type').startsWith('application/json'), res.headers.get('content-type'));
  expect((await res.json()).hello === 'storybook', 'unexpected content');
});
await check('fetch missing file is 404', async () => {
  const res = await fetch('does-not-exist.json');
  expect(res.status === 404, `status ${res.status}`);
});
await check('XMLHttpRequest', () =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', './data.json');
    xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error(`status ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('network error'));
    xhr.send();
  }));
await check('byte range', async () => {
  // {"hello":"storybook"}: bytes 1 to 7 are "hello", quotes included.
  const res = await fetch('data.json', { headers: { Range: 'bytes=1-7' } });
  expect(res.status === 206, `status ${res.status}`);
  expect(res.headers.get('content-range') === 'bytes 1-7/21', res.headers.get('content-range'));
  const slice = await res.text();
  expect(slice === '"hello"', `got ${slice}`);
  const tail = await fetch('data.json', { headers: { Range: 'bytes=-2' } });
  expect(tail.status === 206 && (await tail.text()) === '"}', 'suffix range');
});
await check('file name with a space and non-ASCII letters', async () => {
  const res = await fetch('nested/të dhëna 1.json');
  expect(res.ok, `status ${res.status}`);
  expect((await res.json()).ok === true, 'unexpected content');
});
await check('relative image', () => imageLoaded('relative-image'));
await check('absolute path image (/abs/pixel.png)', () => imageLoaded('absolute-image'));
await check('absolute path fetch (/data.json)', async () => {
  const res = await fetch('/data.json');
  expect(res.ok, `status ${res.status}`);
  expect((await res.json()).hello === 'storybook', 'unexpected content');
});
await check('image from css', async () => {
  const res = await fetch(new URL('nested/pixel.png', document.baseURI));
  expect(res.ok && res.headers.get('content-type') === 'image/png', `${res.status} ${res.headers.get('content-type')}`);
});
await check('web worker', () =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => reject(new Error('no answer')), 5000);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      e.data === 'worker:storybook' ? resolve() : reject(new Error(`got ${e.data}`));
    };
    worker.onerror = (e) => reject(new Error(e.message || 'worker error'));
  }));
await check('wasm content type', async () => {
  const res = await fetch('nested/empty.wasm');
  expect(res.headers.get('content-type') === 'application/wasm', res.headers.get('content-type'));
  await WebAssembly.instantiateStreaming(res);
});
await check('the frame around this page can be read', () => {
  // The manager when shown inside it, the viewer when this page was opened in a tab of its own.
  expect(window.parent !== window, 'not framed');
  expect(typeof window.parent.location.pathname === 'string', 'not readable');
  return window.parent.location.pathname.split('/').pop() || '/';
});
await check('localStorage', () => {
  localStorage.setItem('sbp-selftest', '1');
  expect(localStorage.getItem('sbp-selftest') === '1', 'not stored');
  localStorage.removeItem('sbp-selftest');
});
report('done', true);

document.getElementById('open').addEventListener('click', () => {
  const opened = window.open('iframe.html?opened=window.open');
  report('window.open returned', true, opened === null ? 'null: taken over by the viewer' : 'a window');
});
document.getElementById('register').addEventListener('click', () => {
  navigator.serviceWorker.register('./mockServiceWorker.js').then(
    () => report('service worker registration', false, 'unexpectedly succeeded'),
    (err) => report('service worker registration refused', true, String(err.message).slice(0, 80)),
  );
});

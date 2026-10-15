import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setupPwa } from '../public/app-shell.mjs';

test('manifest의 앱 이름·시작 주소와 실제 192·512 아이콘이 일치한다', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url)));
  assert.equal(manifest.name, 'BYTE BACK 자료실');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}`);
    const png = readFileSync(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

function worker(fetchImpl) {
  const handlers = {};
  const saved = [];
  const cache = { async add(path) { saved.push(path); }, async match(path) {
    assert.equal(path, '/offline.html'); return new Response('공개 오프라인 안내');
  } };
  const self = { location: { origin: 'https://vault.invalid' },
    addEventListener(name, callback) { handlers[name] = callback; } };
  const caches = { async open() { return cache; }, async keys() { return []; }, async delete() {} };
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'),
    { self, caches, fetch: fetchImpl, URL, Response });
  return { handlers, saved };
}

test('공개 오프라인 안내만 저장하고 보호 API·메서드는 가로채지 않는다', async () => {
  const { handlers, saved } = worker(() => { throw new Error('unexpected_fetch'); });
  await new Promise((resolve, reject) => handlers.install({ waitUntil(task) { task.then(resolve, reject); } }));
  assert.deepEqual(saved, ['/offline.html']);
  for (const path of ['/api/session', '/api/learning-notes', '/api/learning-notes/demo', '/api/restore-note', '/data.json']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      let intercepted = false;
      handlers.fetch({ request: { url: `https://vault.invalid${path}`, method, mode: 'navigate' },
        respondWith() { intercepted = true; } });
      assert.equal(intercepted, false);
    }
  }
});

test('화면 연결 실패만 공개 안내로 대체하고 서버 거부 응답은 그대로 둔다', async () => {
  for (const status of [401, 403]) {
    const { handlers } = worker(async () => new Response('denied', { status }));
    let response;
    handlers.fetch({ request: { url: 'https://vault.invalid/', method: 'GET', mode: 'navigate' },
      respondWith(value) { response = value; } });
    assert.equal((await response).status, status);
  }
  const { handlers } = worker(async () => { throw new Error('synthetic_offline'); });
  let response;
  handlers.fetch({ request: { url: 'https://vault.invalid/', method: 'GET', mode: 'navigate' },
    respondWith(value) { response = value; } });
  assert.equal(await (await response).text(), '공개 오프라인 안내');
});

test('설치·오프라인·재연결 이벤트는 기기를 승인 처리하지 않는다', async () => {
  const elements = new Map();
  const windowHandlers = {};
  const buttonHandlers = {};
  const documentRef = { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, { hidden: true, textContent: '',
      addEventListener(name, callback) { buttonHandlers[name] = callback; } });
    return elements.get(selector);
  } };
  const windowRef = { matchMedia() { return { matches: false }; },
    addEventListener(name, callback) { windowHandlers[name] = callback; } };
  Object.defineProperty(windowRef, 'localStorage', { get() { throw new Error('unexpected_storage'); } });
  const navigatorRef = { onLine: true };
  // The approval screen owns this initial text; setupPwa must not touch it.
  const approval = documentRef.querySelector('#device-approval-status');
  approval.textContent = '기기 승인: 미확인';
  let offline = 0;
  let online = 0;
  setupPwa({ windowRef, navigatorRef, documentRef,
    onOffline() { offline++; }, onOnline() { online++; } });
  const original = approval.textContent;
  windowHandlers.beforeinstallprompt({ preventDefault() {}, async prompt() {},
    userChoice: Promise.resolve({ outcome: 'accepted' }) });
  await buttonHandlers.click();
  windowHandlers.appinstalled();
  assert.equal(approval.textContent, original);
  assert.match(approval.textContent, /미확인/u);
  navigatorRef.onLine = false; windowHandlers.offline();
  assert.equal(offline, 1);
  assert.match(elements.get('#connection-status').textContent, /오프라인/u);
  navigatorRef.onLine = true; windowHandlers.online();
  assert.equal(online, 1);
  assert.equal(approval.textContent, original);
});

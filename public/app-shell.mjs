export function setupPwa({ onOffline = () => {}, onOnline = () => {},
  windowRef = window, navigatorRef = navigator, documentRef = document } = {}) {
  const installation = documentRef.querySelector('#installation-status');
  const button = documentRef.querySelector('#install-app');
  const connection = documentRef.querySelector('#connection-status');
  const offlineSupport = documentRef.querySelector('#offline-support');
  // Installation UI never reads or writes device approval or the protected region.
  let installPrompt;
  const standalone = windowRef.matchMedia('(display-mode: standalone)').matches
    || navigatorRef.standalone === true;
  installation.textContent = standalone
    ? '앱 창으로 사용 중입니다.'
    : '웹으로 사용 중입니다. 브라우저 메뉴의 앱 설치 또는 홈 화면 추가를 확인하세요.';
  const updateConnection = () => {
    connection.textContent = navigatorRef.onLine
      ? '온라인 연결 감지 — 로그인·자료 요청 결과는 서버에서 다시 확인합니다.'
      : '오프라인 — 로그인·자료 조회·저장은 사용할 수 없습니다. 연결 후 다시 확인하세요.';
    button.disabled = !navigatorRef.onLine;
  };
  windowRef.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event; button.hidden = false;
  });
  button.addEventListener('click', async () => {
    if (!installPrompt || !navigatorRef.onLine) return;
    const prompt = installPrompt;
    installPrompt = null; button.hidden = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      installation.textContent = choice.outcome === 'accepted'
        ? '브라우저에 앱 설치를 요청했습니다.'
        : '웹으로 계속 사용합니다.';
    } catch { installation.textContent = '브라우저 메뉴에서 설치 가능 여부를 확인하세요.'; }
  });
  windowRef.addEventListener('appinstalled', () => {
    installPrompt = null; button.hidden = true;
    installation.textContent = '앱이 설치됐습니다.';
  });
  windowRef.addEventListener('offline', () => { updateConnection(); onOffline(); });
  windowRef.addEventListener('online', () => { updateConnection(); onOnline(); });
  updateConnection();
  if (!navigatorRef.onLine) onOffline();
  if ('serviceWorker' in navigatorRef) {
    navigatorRef.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(() => { offlineSupport.textContent = '오프라인 안내 기능을 등록했습니다. 비공개 자료와 API 응답은 저장하지 않습니다.'; })
      .catch(() => { offlineSupport.textContent = '오프라인 안내를 준비하지 못했습니다. 온라인으로 이용하세요.'; });
  } else offlineSupport.textContent = '이 브라우저에서는 오프라인 안내를 저장할 수 없습니다.';
}

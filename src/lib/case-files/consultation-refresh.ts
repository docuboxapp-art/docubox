/** Re-read case progress on return, without background polling or duplicate focus requests. */
export function subscribeToCaseListReturn(
  refresh: () => void,
  browser: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  page: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> = document
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const returned = () => {
    if (page.visibilityState !== 'visible') return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (page.visibilityState === 'visible') refresh();
    }, 150);
  };
  browser.addEventListener('focus', returned);
  page.addEventListener('visibilitychange', returned);
  return () => {
    clearTimeout(timer);
    browser.removeEventListener('focus', returned);
    page.removeEventListener('visibilitychange', returned);
  };
}

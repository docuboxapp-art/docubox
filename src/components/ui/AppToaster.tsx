'use client';

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Toaster } from 'sonner';

export default function AppToaster() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const mountHost = useCallback((anchor: HTMLSpanElement | null) => {
    if (!anchor) return;
    const container = document.createElement('div');
    function attach() {
      (document.fullscreenElement ?? document.body).appendChild(container);
    }
    attach();
    setHost(container);
    document.addEventListener('fullscreenchange', attach);
    return () => {
      document.removeEventListener('fullscreenchange', attach);
      container.remove();
    };
  }, []);

  return (
    <>
      <span ref={mountHost} hidden />
      {host &&
        createPortal(
          <Toaster
            position="bottom-center"
            containerAriaLabel="Avisos de Docubox"
            closeButton
            duration={5000}
            visibleToasts={3}
            offset={{ bottom: 'max(24px, env(safe-area-inset-bottom))' }}
            mobileOffset={{
              bottom: 'calc(12px + env(safe-area-inset-bottom))',
              left: 12,
              right: 12,
            }}
            pauseWhenPageIsHidden
          />,
          host
        )}
    </>
  );
}

import { useEffect, useState } from 'react';

/**
 * Nudges phone users to add RaceLens to their home screen so it opens like an
 * app (full screen, its own icon). Shown only on touch devices that are not
 * already running the installed app; dismissal is remembered on the device.
 */
const DISMISS_KEY = 'racelens.installHintDismissed';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function isTouchDevice(): boolean {
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
    return navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

function isIos(): boolean {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallHint() {
  const [visible, setVisible] = useState(() => isTouchDevice() && !isStandalone() && !wasDismissed());
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode – the hint just comes back next time */
    }
  };

  const install = async () => {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === 'accepted') dismiss();
    } catch {
      /* the browser decided not to show its prompt */
    }
    setInstallEvent(null);
  };

  const ios = isIos();
  return (
    <div className="install-hint" role="note" data-testid="install-hint">
      <div className="install-hint__body">
        <strong>Add RaceLens to your home screen for an app-like experience</strong>
        <span className="small">
          {ios ? (
            <>
              iPhone/iPad: tap <span aria-hidden>Share</span>
              <span className="install-hint__key" aria-label="Share icon">
                ⎙
              </span>{' '}
              then <strong>Add to Home Screen</strong>.
            </>
          ) : (
            <>
              Android: open the browser menu <span className="install-hint__key">⋮</span> then <strong>Add to Home screen</strong> (or <strong>Install app</strong>).
            </>
          )}
        </span>
      </div>
      <div className="install-hint__actions">
        {installEvent && (
          <button type="button" className="btn btn-primary btn-sm" onClick={install} data-testid="install-btn">
            Install
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss} data-testid="install-dismiss">
          Not now
        </button>
      </div>
    </div>
  );
}

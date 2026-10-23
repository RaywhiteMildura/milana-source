import { useEffect, useState } from 'react';

/**
 * Nudges phone users to add RaceLens to their home screen so it opens like an
 * app (full screen, its own icon). Shown only on phones and tablets (a coarse
 * primary pointer, or iOS) that are not already running the installed app – not
 * on touch-screen laptops, whose primary pointer is a mouse or trackpad – with
 * the steps for that platform. Dismissal is remembered on the device.
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

function isIos(): boolean {
  const ua = navigator.userAgent || '';
  // iPadOS Safari reports a Mac; a real Mac has no touch points.
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent || '');
}

/**
 * A phone or tablet. `maxTouchPoints` alone is not enough: Windows touch-screen
 * laptops report touch points while their primary pointer is fine. iOS is
 * included for an iPad driven with a trackpad (and iOS never offers its own
 * install prompt).
 */
function isPhoneOrTablet(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches || isIos();
  } catch {
    return false;
  }
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function InstallHint() {
  const [visible, setVisible] = useState(() => isPhoneOrTablet() && !isStandalone() && !wasDismissed());
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
          ) : isAndroid() ? (
            <>
              Android: open the browser menu <span className="install-hint__key">⋮</span> then <strong>Add to Home screen</strong>
              {typeof window !== 'undefined' && window.isSecureContext ? (
                <>
                  {' '}
                  (or <strong>Install app</strong>).
                </>
              ) : (
                <> (it opens in Chrome; full-screen needs an https address – see the guide).</>
              )}
            </>
          ) : (
            <>
              Open your browser's menu, then <strong>Install app</strong> or <strong>Add to Home screen</strong>.
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

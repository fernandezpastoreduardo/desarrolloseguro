import { useEffect, useRef, useState } from "react";
import "./first-entry-notice.scss";

const NOTICE_STORAGE_KEY = "ds-first-entry-notice-dismissed";
const PRIVACY_POLICY_PATH = "/desarrollo-seguro/politica-de-privacidad.html";

function hasDismissedNotice(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal(): void {
  try {
    window.localStorage.setItem(NOTICE_STORAGE_KEY, "1");
  } catch {
    // Storage can be disabled; the notice remains available on later visits.
  }
}

export function FirstEntryNotice() {
  const [isOpen, setIsOpen] = useState(() => !hasDismissedNotice());
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isOpen) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="ds-first-entry-notice"
      aria-label="Aviso informativo sobre cookies"
      aria-describedby="ds-first-entry-copy"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="ds-first-entry-notice__content">
        <img
          className="ds-first-entry-notice__logo"
          src="/app/assets/desarrollo-seguro-logo-v1.svg"
          alt="DesarrolloSeguro.org"
        />
        <p id="ds-first-entry-copy" className="ds-first-entry-notice__copy">
          No usamos cookies que envíen o vendan información a nadie en esta web.
        </p>
        <a
          className="ds-first-entry-notice__policy-link"
          href={PRIVACY_POLICY_PATH}
          target="_blank"
          rel="noopener noreferrer"
        >
          Política de privacidad
        </a>
        <button
          className="ds-first-entry-notice__dismiss"
          type="button"
          onClick={() => {
            rememberDismissal();
            setIsOpen(false);
          }}
          autoFocus
        >
          Entendido
        </button>
      </div>
    </dialog>
  );
}

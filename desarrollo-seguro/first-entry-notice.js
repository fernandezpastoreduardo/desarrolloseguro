const NOTICE_STORAGE_KEY = "ds-first-entry-notice-dismissed";
const PRIVACY_POLICY_PATH = "/desarrollo-seguro/politica-de-privacidad.html";

function hasDismissedNotice() {
  try {
    return window.localStorage.getItem(NOTICE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(NOTICE_STORAGE_KEY, "1");
  } catch {
    // If storage is unavailable, the notice remains available on later visits.
  }
}

function createNotice() {
  const dialog = document.createElement("dialog");
  dialog.className = "ds-first-entry-notice";
  dialog.setAttribute("aria-label", "Aviso informativo sobre cookies");
  dialog.setAttribute("aria-describedby", "ds-first-entry-copy");

  const content = document.createElement("div");
  content.className = "ds-first-entry-notice__content";

  const logo = document.createElement("img");
  logo.className = "ds-first-entry-notice__logo";
  logo.src = "/desarrollo-seguro/assets/desarrollo-seguro-logo-v1.svg";
  logo.alt = "DesarrolloSeguro.org";

  const copy = document.createElement("p");
  copy.id = "ds-first-entry-copy";
  copy.className = "ds-first-entry-notice__copy";
  copy.textContent = "No usamos cookies que envíen o vendan información a nadie en esta web.";

  const policyLink = document.createElement("a");
  policyLink.className = "ds-first-entry-notice__policy-link";
  policyLink.href = PRIVACY_POLICY_PATH;
  policyLink.textContent = "Política de privacidad";
  policyLink.target = "_blank";
  policyLink.rel = "noopener noreferrer";

  const button = document.createElement("button");
  button.className = "ds-first-entry-notice__dismiss";
  button.type = "button";
  button.textContent = "Entendido";
  button.addEventListener("click", () => {
    rememberDismissal();
    dialog.close();
    dialog.remove();
  });

  content.append(logo, copy, policyLink, button);
  dialog.append(content);
  document.body.append(dialog);
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  dialog.showModal();
  button.focus();
}

if (!hasDismissedNotice()) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createNotice, { once: true });
  } else {
    createNotice();
  }
}

export interface TurnstileClient {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme: "auto";
      size: "compact" | "normal";
      callback(token: string): void;
      "expired-callback"(): void;
      "error-callback"(): void;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
}

export interface ContactFormOptions {
  form: HTMLFormElement;
  challenge: HTMLElement;
  verificationStatus: HTMLElement;
  deliveryStatus: HTMLElement;
  submitButton: HTMLButtonElement;
  acceptedIndicator: HTMLElement;
  sitekey: string;
  action?: string;
  endpoint?: string;
  /** Preserve each site's existing visitor-authored local draft key. */
  draftKey?: string;
  /** False keeps drafts only in the current form; storage is never read or written. */
  persistDraft?: boolean;
  retryVerificationButton?: HTMLButtonElement;
  turnstile?: () => TurnstileClient | undefined;
}

const mounts = new WeakMap<HTMLFormElement, () => void>();
const fields = ["name", "email", "subject", "message"] as const;

/** Native DOM client only; private bindings and server code are outside this entry point. */
export function mountContactForm(options: ContactFormOptions): () => void {
  const previous = mounts.get(options.form);
  if (previous) return previous;
  const { form, challenge, verificationStatus, deliveryStatus, submitButton, acceptedIndicator } =
    options;
  const draftKey = options.draftKey ?? "contact-form-draft";
  const persistDraft = options.persistDraft !== false;
  const retryButton = options.retryVerificationButton;
  if (retryButton) retryButton.type = "button";
  let loader: HTMLScriptElement | undefined;
  const cancelLoader = () => {
    if (!loader) return;
    loader.onload = null;
    loader.onerror = null;
    loader.remove();
    loader = undefined;
  };
  const retryVisible = (visible: boolean) => {
    if (retryButton) retryButton.hidden = !visible;
  };
  retryVisible(false);
  const provider =
    options.turnstile ?? (() => (window as Window & { turnstile?: TurnstileClient }).turnstile);
  let requestId = crypto.randomUUID();
  let token = "";
  let widgetId = "";
  let sending = false;
  let disposed = false;
  let widgetGeneration = 0;
  let requestController: AbortController | undefined;
  const events = new AbortController();
  const listener = { signal: events.signal };
  const compact = matchMedia("(max-width: 360px)");
  const setDelivery = (state: "idle" | "sending" | "accepted" | "error", text: string) => {
    deliveryStatus.dataset.contactState = state;
    deliveryStatus.textContent = text;
    acceptedIndicator.hidden = state !== "accepted";
    form.dataset.contactState = state;
  };
  deliveryStatus.setAttribute("role", "status");
  deliveryStatus.setAttribute("aria-live", "polite");
  deliveryStatus.setAttribute("aria-atomic", "true");
  verificationStatus.setAttribute("role", "status");
  verificationStatus.setAttribute("aria-live", "polite");
  acceptedIndicator.setAttribute("aria-hidden", "true");
  setDelivery("idle", "");
  const expire = () => {
    token = "";
    submitButton.disabled = true;
  };
  expire();
  const values = () =>
    Object.fromEntries(fields.map((name) => [name, new FormData(form).get(name)]));
  try {
    const draft = persistDraft ? JSON.parse(localStorage.getItem(draftKey) ?? "null") : null;
    if (draft && typeof draft === "object")
      for (const name of fields) {
        const field = form.elements.namedItem(name);
        if (
          (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
          typeof draft[name] === "string"
        )
          field.value = draft[name].slice(0, field.maxLength < 0 ? undefined : field.maxLength);
      }
  } catch {
    /* Storage is optional. */
  }
  form.addEventListener(
    "input",
    (event) => {
      const field = event.target;
      if (
        !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) ||
        !fields.some((name) => name === field.name)
      )
        return;
      requestId = crypto.randomUUID();
      if (!sending) setDelivery("idle", "");
      try {
        if (persistDraft) localStorage.setItem(draftKey, JSON.stringify(values()));
      } catch {
        /* Keep typing usable. */
      }
    },
    listener,
  );
  const renderWidget = () => {
    const turnstile = provider();
    if (disposed || !navigator.onLine || !turnstile) return;
    const generation = ++widgetGeneration;
    expire();
    if (widgetId) turnstile.remove(widgetId);
    widgetId = turnstile.render(challenge, {
      sitekey: options.sitekey,
      ...(options.action ? { action: options.action } : {}),
      theme: "auto",
      size: compact.matches ? "compact" : "normal",
      callback: (value) => {
        if (disposed || generation !== widgetGeneration) return;
        if (!navigator.onLine) return;
        token = value;
        retryVisible(false);
        submitButton.disabled = sending || !navigator.onLine || !token;
        verificationStatus.textContent = navigator.onLine
          ? "Verification ready."
          : "You are offline. Your draft is kept here; reconnect to verify and send.";
      },
      "expired-callback": () => {
        if (disposed || generation !== widgetGeneration) return;
        expire();
        retryVisible(navigator.onLine);
        verificationStatus.textContent = "Verification expired. Please verify again.";
      },
      "error-callback": () => {
        if (disposed || generation !== widgetGeneration) return;
        expire();
        retryVisible(navigator.onLine);
        verificationStatus.textContent = "Verification failed. Please verify again.";
      },
    });
  };
  const startVerification = () => {
    if (disposed || sending) return;
    expire();
    retryVisible(false);
    if (!navigator.onLine) {
      verificationStatus.textContent =
        "You are offline. Your draft is kept here; reconnect to verify and send.";
      return;
    }
    if (provider()) {
      if (widgetId) provider()!.reset(widgetId);
      else renderWidget();
      return;
    }
    if (loader) return;
    const attempt = document.createElement("script");
    loader = attempt;
    attempt.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    attempt.async = true;
    const failed = () => {
      if (disposed || loader !== attempt) return;
      cancelLoader();
      expire();
      retryVisible(navigator.onLine);
      verificationStatus.textContent = "Verification could not load. Please retry verification.";
    };
    attempt.onload = () => {
      if (disposed || loader !== attempt) return;
      if (!provider()) return failed();
      cancelLoader();
      renderWidget();
    };
    attempt.onerror = failed;
    document.head.append(attempt);
  };
  retryButton?.addEventListener("click", startVerification, listener);
  compact.addEventListener("change", renderWidget, listener);
  window.addEventListener(
    "offline",
    () => {
      expire();
      cancelLoader();
      retryVisible(false);
      verificationStatus.textContent =
        "You are offline. Your draft is kept here; reconnect to verify and send.";
    },
    listener,
  );
  window.addEventListener(
    "online",
    () => {
      expire();
      verificationStatus.textContent = "Reconnected. Please verify again before sending.";
      startVerification();
    },
    listener,
  );
  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      if (sending || !navigator.onLine || !token || !form.reportValidity()) return;
      const identity = requestId;
      const payload = { ...values(), turnstileToken: token, requestId: identity };
      const controller = new AbortController();
      requestController = controller;
      const timeout = setTimeout(() => controller.abort(), 30_000);
      sending = true;
      submitButton.disabled = true;
      setDelivery("sending", "Sending\u2026");
      try {
        const response = await fetch(options.endpoint ?? "/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(payload),
        });
        const result: unknown = await response.json();
        if (
          !response.ok ||
          !result ||
          typeof result !== "object" ||
          !("success" in result) ||
          result.success !== true
        ) {
          const message =
            result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string" &&
            result.error.trim().length > 0
              ? result.error
              : "Your message could not be sent. Please retry.";
          throw new Error(message);
        }
        if (disposed) return;
        setDelivery("accepted", "Message sent.");
        if (identity === requestId) {
          form.reset();
          requestId = crypto.randomUUID();
          try {
            if (persistDraft) localStorage.removeItem(draftKey);
          } catch {
            /* Visible acceptance remains valid. */
          }
        } else acceptedIndicator.hidden = true; // Preserve edits made while the accepted request was pending.
      } catch (error) {
        if (disposed) return;
        setDelivery(
          "error",
          error instanceof DOMException && error.name === "AbortError"
            ? "The request timed out. Your message may have been accepted. Please wait before retrying; another attempt may deliver a duplicate."
            : error instanceof Error
              ? error.message
              : "Your message could not be sent. Please retry.",
        );
      } finally {
        clearTimeout(timeout);
        requestController = undefined;
        sending = false;
        if (!disposed) {
          expire();
          if (navigator.onLine && widgetId) provider()?.reset(widgetId);
        }
      }
    },
    listener,
  );
  const dispose = () => {
    disposed = true;
    events.abort();
    requestController?.abort();
    cancelLoader();
    if (widgetId) provider()?.remove(widgetId);
    mounts.delete(form);
  };
  mounts.set(form, dispose);
  startVerification();
  return dispose;
}

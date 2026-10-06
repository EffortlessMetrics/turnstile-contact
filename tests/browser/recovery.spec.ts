import { test, expect, type Page } from "@playwright/test";
test("offline and reconnect invalidate stale success, error and expiry callbacks", async ({
  page,
}) => {
  let sends = 0;
  await page.addInitScript(() => {
    (window as any).syntheticOnline = true;
    Object.defineProperty(navigator, "onLine", { get: () => (window as any).syntheticOnline });
  });
  await page.route("**/api/contact", (r) => {
    sends++;
    return r.abort();
  });
  await page.goto("/?defer=true");
  await fields(page);
  await page.evaluate(() => {
    (window as any).oldOptions = (window as any).widgetOptions;
    (window as any).refreshToken();
  });
  const submit = page.getByRole("button", { name: "Send message", exact: true });
  await expect(submit).toBeEnabled();
  await page.evaluate(() => {
    (window as any).syntheticOnline = false;
    window.dispatchEvent(new Event("offline"));
    (window as any).oldOptions.callback("stale-offline");
    (window as any).oldOptions["error-callback"]();
    (window as any).oldOptions["expired-callback"]();
  });
  await expect(submit).toBeDisabled();
  await expect(page.locator("#verification")).toContainText("offline");
  await page.evaluate(() => {
    (window as any).syntheticOnline = true;
    window.dispatchEvent(new Event("online"));
  });
  await expect(submit).toBeDisabled();
  const status = await page.locator("#verification").textContent();
  await page.evaluate(() => {
    (window as any).oldOptions.callback("stale-reconnected");
    (window as any).oldOptions["error-callback"]();
    (window as any).oldOptions["expired-callback"]();
  });
  await expect(submit).toBeDisabled();
  await expect(page.locator("#verification")).toHaveText(status!);
  await page.evaluate(() => (window as any).refreshToken());
  await expect(submit).toBeEnabled();
  expect(sends).toBe(0);
});
test("HTML platform errors show the visible retry message rather than JSON parser details", async ({
  page,
}) => {
  await page.route("**/api/contact", (r) =>
    r.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" }),
  );
  await page.goto("/");
  await fields(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#delivery")).toHaveText(
    "Your message could not be sent. Please retry.",
  );
  await expect(page.locator("#delivery")).toBeVisible();
  await expect(page.locator("#accepted")).toBeHidden();
});
test("timeout while reading response JSON retains the ambiguous-delivery warning", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await fields(page);
  await page.evaluate(() => {
    window.fetch = async (_input, init) =>
      ({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () =>
              reject(new DOMException("Aborted body", "AbortError")),
            );
          }),
      }) as Response;
  });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.clock.fastForward(30001);
  await expect(page.locator("#delivery")).toContainText("may have been accepted");
  await expect(page.locator("#delivery")).toContainText("may deliver a duplicate");
  await expect(page.locator("#accepted")).toBeHidden();
});
const mockProvider = `window.turnstile={render:(element,options)=>{window.widgetOptions=options;window.refreshToken=()=>options.callback('mock-fresh-token');window.refreshToken();return 'remote-widget'},reset:()=>window.refreshToken(),remove:()=>{}};`;
async function fields(page: Page) {
  await page.getByLabel("Name", { exact: true }).fill("Synthetic sender");
  await page.getByLabel("Email", { exact: true }).fill("sender@example.test");
  await page.getByLabel("Subject", { exact: true }).fill("Synthetic subject");
  await page.getByLabel("Message", { exact: true }).fill("Synthetic draft");
}
test("initially offline defers all provider requests and reconnect never sends automatically", async ({
  page,
}) => {
  let vendors = 0,
    sends = 0;
  await page.addInitScript(() => {
    (window as any).syntheticOnline = false;
    Object.defineProperty(navigator, "onLine", { get: () => (window as any).syntheticOnline });
  });
  await page.route("https://challenges.cloudflare.com/**", (r) => {
    vendors++;
    return r.fulfill({ contentType: "text/javascript", body: mockProvider });
  });
  await page.route("**/api/contact", (r) => {
    sends++;
    return r.abort();
  });
  await page.goto("/?provider=remote");
  await fields(page);
  await expect(page.locator("#verification")).toContainText("offline");
  await expect(page.locator('script[src*="challenges.cloudflare.com"]')).toHaveCount(0);
  expect(vendors).toBe(0);
  await page.evaluate(() => {
    (window as any).syntheticOnline = true;
    window.dispatchEvent(new Event("online"));
  });
  await expect(page.locator("#verification")).toHaveText("Verification ready.");
  expect(vendors).toBe(1);
  expect(sends).toBe(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Synthetic draft");
});
test("failed provider load retries in place without reload or automatic send", async ({ page }) => {
  let attempts = 0,
    sends = 0;
  await page.route("https://challenges.cloudflare.com/**", (r) => {
    attempts++;
    return attempts === 1
      ? r.abort()
      : r.fulfill({ contentType: "text/javascript", body: mockProvider });
  });
  await page.route("**/api/contact", (r) => {
    sends++;
    return r.abort();
  });
  await page.goto("/?provider=remote");
  await fields(page);
  await expect(page.getByRole("button", { name: "Retry verification" })).toBeVisible();
  await page.getByRole("button", { name: "Retry verification" }).click();
  await expect(page.locator("#verification")).toHaveText("Verification ready.");
  await expect(page.getByRole("button", { name: "Retry verification" })).toBeHidden();
  expect(attempts).toBe(2);
  expect(sends).toBe(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Synthetic draft");
});
test("expired widget retries fresh verification in place without submission", async ({ page }) => {
  let sends = 0;
  await page.route("**/api/contact", (r) => {
    sends++;
    return r.abort();
  });
  await page.goto("/");
  await fields(page);
  await page.evaluate(() => (window as any).widgetOptions["expired-callback"]());
  await expect(page.getByRole("button", { name: "Retry verification" })).toBeVisible();
  await page.getByRole("button", { name: "Retry verification" }).click();
  await expect(page.locator("#verification")).toHaveText("Verification ready.");
  expect(sends).toBe(0);
});
test("nonpersistent drafts never access storage and remain available in the open form", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).storageAccesses = [];
    for (const key of ["getItem", "setItem", "removeItem"] as const)
      Storage.prototype[key] = function () {
        (window as any).storageAccesses.push(key);
        throw new Error("No storage access allowed");
      };
  });
  await page.goto("/?persist=false");
  await fields(page);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Synthetic draft");
  await page.route("**/api/contact", (r) => r.fulfill({ json: { success: true } }));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#accepted")).toBeVisible();
  expect(await page.evaluate(() => (window as any).storageAccesses)).toEqual([]);
});

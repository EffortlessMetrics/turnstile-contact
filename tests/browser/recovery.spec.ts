import { test, expect, type Page } from "@playwright/test";
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

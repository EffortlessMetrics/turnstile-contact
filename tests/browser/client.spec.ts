import { test, expect, type Page } from "@playwright/test";
async function fields(page: Page, subject = "Synthetic subject") {
  await page.getByLabel("Name", { exact: true }).fill("Synthetic sender");
  await page.getByLabel("Email", { exact: true }).fill("sender@example.test");
  await page.getByLabel("Subject", { exact: true }).fill(subject);
  await page.getByLabel("Message", { exact: true }).fill("Synthetic message, never delivered.");
}
test("verification-only never reports delivery acceptance or submits", async ({ page }) => {
  let sends = 0;
  await page.route("**/api/contact", (r) => {
    sends++;
    return r.abort();
  });
  await page.goto("/");
  await expect(page.locator("#verification")).toHaveText("Verification ready.");
  await expect(page.locator("#accepted")).toBeHidden();
  await expect(page.locator("#delivery")).toHaveText("");
  expect(sends).toBe(0);
});
test("accepted and repeated sends announce accessibly, show one check and use new identities", async ({
  page,
}) => {
  const payloads: any[] = [];
  await page.route("**/api/contact", (r) => {
    payloads.push(r.request().postDataJSON());
    return r.fulfill({ json: { success: true, message: "Unapproved extra thank-you copy" } });
  });
  await page.goto("/");
  await fields(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#accepted")).toBeVisible();
  await expect(page.locator("#delivery")).toHaveText("Message sent.");
  await expect(page.locator("#delivery")).toHaveAttribute("role", "status");
  await expect(page.locator("#delivery")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#delivery")).toHaveAttribute("aria-atomic", "true");
  await expect(page.locator("#accepted")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
  await fields(page, "Second subject");
  await expect(page.locator("#accepted")).toBeHidden();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#accepted")).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[0].requestId).not.toBe(payloads[1].requestId);
});
for (const response of [
  { status: 200, json: { success: false, error: "Rejected payload" } },
  { status: 503, json: { success: true } },
  { status: 200, json: { success: "true" } },
  { status: 200, json: { success: false, error: "" } },
])
  test(`requires HTTP and boolean acceptance ${JSON.stringify(response)}`, async ({ page }) => {
    await page.route("**/api/contact", (r) => r.fulfill(response));
    await page.goto("/");
    await fields(page);
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator("#delivery")).toHaveAttribute("data-contact-state", "error");
    await expect(page.locator("#delivery")).toBeVisible();
    await expect(page.locator("#accepted")).toBeHidden();
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Synthetic subject");
  });
test("failure after success removes accepted state and retry preserves fields and identity with fresh token", async ({
  page,
}) => {
  const payloads: any[] = [];
  await page.route("**/api/contact", (r) => {
    payloads.push(r.request().postDataJSON());
    return r.fulfill(
      payloads.length === 2
        ? { status: 503, json: { error: "Visible retry error" } }
        : { json: { success: true } },
    );
  });
  await page.goto("/");
  await fields(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#accepted")).toBeVisible();
  await fields(page, "Next message");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#delivery")).toHaveText("Visible retry error");
  await expect(page.locator("#accepted")).toBeHidden();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#accepted")).toBeVisible();
  expect(payloads[1].requestId).toBe(payloads[2].requestId);
  expect(payloads[1].turnstileToken).not.toBe(payloads[2].turnstileToken);
});
test("mounting twice does not send twice; editing a pending request preserves the new draft", async ({
  page,
}) => {
  let send: any;
  let count = 0;
  await page.route("**/api/contact", (r) => {
    count++;
    send = r;
  });
  await page.goto("/");
  await fields(page);
  await page.evaluate(() => (window as any).mountAgain());
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => count).toBe(1);
  await page.getByLabel("Message", { exact: true }).fill("New draft while awaiting acceptance.");
  await send.fulfill({ json: { success: true } });
  await expect(page.locator("#delivery")).toHaveText("Message sent.");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "New draft while awaiting acceptance.",
  );
  await expect(page.locator("#accepted")).toBeHidden();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("contact-form-draft")!).message),
  ).toBe("New draft while awaiting acceptance.");
});

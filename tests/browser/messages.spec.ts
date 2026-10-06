import { test, expect } from "@playwright/test";
declare const process: { env: Record<string, string | undefined> };
test.skip(
  process.env.CONTACT_EXPECT_MESSAGE_API !== "true",
  "Published baseline has no semantic presentation API",
);
const messages = {
  "verification-ready": "Custom ready",
  "verification-expired": "Custom expired",
  "verification-offline": "Custom offline",
  "delivery-network-error": "Custom network",
  "delivery-server-timeout": "Custom service timeout",
  "delivery-form-unavailable": "Custom form unavailable",
  "delivery-service-unavailable": "Custom service unavailable",
  "delivery-client-timeout": "Custom client timeout",
  "delivery-accepted": "Custom accepted",
};
async function setup(page: import("@playwright/test").Page) {
  await page.addInitScript((messages) => {
    (window as any).contactMessages = messages;
  }, messages);
  await page.goto("/?customMessages=true");
  await page.getByLabel("Name", { exact: true }).fill("Private synthetic name");
  await page.getByLabel("Email", { exact: true }).fill("private@example.test");
  await page.getByLabel("Subject", { exact: true }).fill("Synthetic subject");
  await page.getByLabel("Message", { exact: true }).fill("Private synthetic body");
}
test("semantic verification messages preserve disabled/ready lifecycle", async ({ page }) => {
  await setup(page);
  await expect(page.locator("#verification")).toHaveText("Custom ready");
  await page.evaluate(() => (window as any).widgetOptions["expired-callback"]());
  await expect(page.locator("#verification")).toHaveText("Custom expired");
  await expect(page.locator("#submit")).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator("#verification")).toHaveText("Custom offline");
  await expect(page.locator("#submit")).toBeDisabled();
});
for (const scenario of [
  { name: "network", code: "delivery-network-error", expected: "Custom network" },
  {
    name: "server-timeout",
    code: "delivery-server-timeout",
    status: 504,
    expected: "Custom service timeout",
  },
  {
    name: "form-unavailable",
    code: "delivery-form-unavailable",
    status: 503,
    serverCode: "form-unavailable",
    expected: "Custom form unavailable",
  },
  {
    name: "service-unavailable",
    code: "delivery-service-unavailable",
    status: 502,
    serverCode: "service-unavailable",
    expected: "Custom service unavailable",
  },
  {
    name: "rejected",
    code: "delivery-rejected",
    status: 422,
    expected: "Arbitrary localized server message",
  },
])
  test(`stable ${scenario.name} code does not match English strings`, async ({ page }) => {
    await setup(page);
    if (scenario.name === "network")
      await page.evaluate(() => {
        window.fetch = async () => {
          throw new TypeError("Unrelated localized network message");
        };
      });
    else
      await page.route("**/api/contact", (r) =>
        r.fulfill({
          status: scenario.status!,
          json: {
            error: "Arbitrary localized server message",
            ...(scenario.serverCode ? { code: scenario.serverCode } : {}),
          },
        }),
      );
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.locator("#delivery")).toHaveText(scenario.expected);
    await expect(page.locator("#accepted")).toBeHidden();
    const events = await page.evaluate(() => (window as any).deliveryEvents);
    expect(events.at(-1)).toEqual({ state: "error", code: scenario.code });
    expect(
      events.every((event: any) =>
        Object.keys(event).every((key) => key === "state" || key === "code"),
      ),
    ).toBe(true);
  });
test("client timeout message preserves request identity and draft", async ({ page }) => {
  await page.clock.install();
  await setup(page);
  await page.evaluate(() => {
    window.fetch = async (_input, init) =>
      new Promise((_resolve, reject) =>
        init!.signal!.addEventListener("abort", () =>
          reject(new DOMException("Localized timeout", "AbortError")),
        ),
      );
  });
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.clock.fastForward(30001);
  await expect(page.locator("#delivery")).toHaveText("Custom client timeout");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Private synthetic body");
  expect((await page.evaluate(() => (window as any).deliveryEvents)).at(-1)).toEqual({
    state: "error",
    code: "delivery-client-timeout",
  });
});
test("accepted event contains only semantic status and preserves green indicator", async ({
  page,
}) => {
  await page.route("**/api/contact", (r) => r.fulfill({ json: { success: true } }));
  await setup(page);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator("#delivery")).toHaveText("Custom accepted");
  await expect(page.locator("#accepted")).toBeVisible();
  expect((await page.evaluate(() => (window as any).deliveryEvents)).at(-1)).toEqual({
    state: "accepted",
    code: "delivery-accepted",
  });
});

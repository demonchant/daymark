import { test, expect } from "@playwright/test";

test("empty configuration stays honest and disables the chain action", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /make today count/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /mark today/i })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(/vite_daymark_address/i);
  await expect(page.getByText("Current streak")).toBeVisible();
  await expect(page.getByText("—", { exact: true }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("wallet setup errors remain visible and do not claim a success", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await expect(page.getByRole("status")).toContainText(/vite_daymark_address/i);
  await expect(page.getByRole("status")).not.toContainText(/confirmed|success/i);
  await expect(page.getByRole("button", { name: /mark today/i })).toBeDisabled();
});

test("layout fits a phone viewport and keyboard focus is visible", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /make today count/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).toBe("A");
});

import { expect, test } from "@playwright/test";

test("cockpit compresses a scattered thought", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  await expect(page.getByRole("heading", { name: "Current Goal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next Action" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof Needed" })).toBeVisible();
  await page.getByRole("button", { name: /OpenUI/ }).first().click();
  await expect(page.getByTestId("generated-surface")).toContainText(
    "No generated surface for this turn.",
  );
  const loopButton = page.getByRole("button", { name: /Loop/ }).first();
  if ((await loopButton.count()) > 0 && (await loopButton.isVisible())) {
    await loopButton.click();
  }

  await page.getByRole("main").getByRole("button", { name: "Assistant" }).click();
  await expect(
    page.getByRole("heading", { name: "Assistant Command Center" }),
  ).toBeVisible();
  await page
    .getByLabel("Assistant message")
    .fill("I know the UI is wrong but I cannot explain it");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.locator("ol").getByText("What feels wrong").first()).toBeVisible();
  await page.getByRole("button", { name: "Use in Cockpit" }).first().click();
  await page.getByLabel("Close Assistant Command Center").click();
  await expect(page.getByLabel("Scattered thought")).toHaveValue(
    /I know the UI is wrong but I cannot explain it/,
  );

  await page
    .getByLabel("Scattered thought")
    .fill("I need to build this app, but also maybe redo memory, docs, and tests.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("current-goal")).toContainText(
    /cockpit|app|stabilize/i,
  );
  await expect(page.getByTestId("next-action")).toBeVisible();
  await expect(page.getByTestId("proof-needed")).toBeVisible();

  await page.getByRole("button", { name: /Side quests/ }).first().click();
  await page
    .getByPlaceholder("Park a distracting-but-valid idea")
    .fill("Later: explore keyboard shortcuts.");
  await page.getByPlaceholder("Park a distracting-but-valid idea").press("Enter");
  await expect(page.getByTestId("parking-lot")).toContainText(
    "Later: explore keyboard shortcuts.",
  );

  await page.reload();
  await expect(page.getByTestId("parking-lot")).toContainText(
    "Later: explore keyboard shortcuts.",
  );
});

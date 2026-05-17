import { expect, test } from "@playwright/test";

test("cockpit compresses a scattered thought", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  await expect(page.getByRole("heading", { name: "Current Goal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next Action" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof Needed" })).toBeVisible();
  await expect(page.getByTestId("thought-chat")).toBeVisible();
  await expect(page.getByTestId("generated-surface")).toContainText(
    "No generated surface for this turn.",
  );

  await page.getByRole("button", { name: "Thought Chat" }).click();
  await page
    .getByPlaceholder("Help me put this into words")
    .fill("I know the UI is wrong but I cannot explain it");
  await page.getByRole("button", { name: "Phrase" }).click();
  await expect(page.getByText("What feels wrong")).toBeVisible();
  await page.getByRole("button", { name: "Use As Cockpit Input" }).click();
  await expect(page.getByLabel("Scattered thought")).toHaveValue(
    /I know the UI is wrong but I cannot explain it/,
  );

  await page
    .getByLabel("Scattered thought")
    .fill("I need to build this app, but also maybe redo memory, docs, and tests.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByTestId("current-goal")).toContainText("Stabilize");
  await expect(page.getByTestId("next-action")).toBeVisible();
  await expect(page.getByTestId("proof-needed")).toContainText("repo artifact");

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

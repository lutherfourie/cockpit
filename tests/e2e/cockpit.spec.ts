import { expect, test } from "@playwright/test";

test("cockpit compresses a scattered thought", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Current Goal" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Next Action" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof Needed" })).toBeVisible();

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

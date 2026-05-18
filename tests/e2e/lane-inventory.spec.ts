import { expect, test } from "@playwright/test";

test("lane inventory panel lists fixture lane and generates handoff", async ({
  page,
}) => {
  await page.goto("/");

  // The cockpit-app integration added a "Lanes" rail button that switches the
  // lower surface to render LaneInventoryPanel. Click it first.
  await page.getByRole("button", { name: /^Lanes$/i }).click();

  // Wait for the panel header (rendered as "Lanes (N)" by LaneInventoryPanel).
  await expect(page.getByRole("heading", { name: /Lanes \(/ })).toBeVisible({
    timeout: 10_000,
  });

  // The fixture lane name is "sample-feedback-triage".
  await expect(page.getByText("sample-feedback-triage")).toBeVisible();

  // Pick codex.cli as target and click "Generate handoff".
  const laneCard = page
    .locator("article")
    .filter({ hasText: "sample-feedback-triage" });
  await laneCard.locator("select").selectOption("codex.cli");
  await laneCard.getByRole("button", { name: /Generate handoff/i }).click();

  // The handoff artifact should appear in a <pre>.
  await expect(laneCard.locator("pre")).toContainText(
    "# Handoff: sample-feedback-triage",
    { timeout: 5_000 },
  );
  await expect(laneCard.locator("pre")).toContainText("**Target:** codex.cli");
  await expect(laneCard.locator("pre")).toContainText("## Read scope");
});

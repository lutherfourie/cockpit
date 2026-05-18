import { expect, test } from "@playwright/test";

test("lane inventory panel lists fixture lane and generates handoff", async ({
  page,
}, testInfo) => {
  // The Lanes rail entry is hidden on mobile viewports (cockpit-rail is
  // `hidden ... lg:block`). Mobile entry to the Lanes panel is Phase 2 work.
  test.skip(
    testInfo.project.name === "mobile-chrome",
    "Lanes rail is hidden below lg breakpoint; mobile entry is Phase 2",
  );

  await page.goto("/");

  // The cockpit-app integration added a "Lanes" rail button that switches the
  // lower surface to render LaneInventoryPanel. Click it first.
  await page.getByRole("button", { name: /^Lanes$/i }).click();

  // Wait for the panel heading; scope to <main> so we don't pick up an
  // accidental sibling heading elsewhere in the shell.
  await expect(
    page.getByRole("main").getByRole("heading", { name: /Lanes \(/ }),
  ).toBeVisible({ timeout: 10_000 });

  // The fixture lane name is "sample-feedback-triage".
  await expect(page.getByText("sample-feedback-triage")).toBeVisible();

  // Scope to the lane card and pick a non-default target so the dropdown
  // change handler is genuinely exercised. The default in HandoffControls
  // is codex.cli; we choose claude.code here.
  const laneCard = page
    .locator("article")
    .filter({ hasText: "sample-feedback-triage" });
  await expect(laneCard.locator("select")).toHaveValue("codex.cli");
  await laneCard.locator("select").selectOption("claude.code");
  await expect(laneCard.locator("select")).toHaveValue("claude.code");

  await laneCard.getByRole("button", { name: /Generate handoff/i }).click();

  // The handoff artifact should appear in a <pre>, with the claude.code
  // target rendered in the body.
  await expect(laneCard.locator("pre")).toContainText(
    "# Handoff: sample-feedback-triage",
    { timeout: 5_000 },
  );
  await expect(laneCard.locator("pre")).toContainText("**Target:** claude.code");
  await expect(laneCard.locator("pre")).toContainText("## Read scope");
});

import { expect, test as setup } from "@playwright/test";
import { SEEDED_USER, SESSION } from "./fixtures";
import { logIn } from "./helpers";

// Signs the seeded account in once, through the login page; the specs about
// the data reuse its cookie instead of each signing in (the login is rate
// limited, and its own path is what accounts.spec.ts checks).
setup("sign in the seeded account", async ({ page }) => {
  await logIn(page, SEEDED_USER.email, SEEDED_USER.password);
  await expect(page).toHaveURL(/\/cotes/);
  await page.context().storageState({ path: SESSION });
});

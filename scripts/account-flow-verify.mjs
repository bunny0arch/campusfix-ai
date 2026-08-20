import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:3000";
const username = `journey${Date.now()}`;
let password = "CampusFixJourneyPass2026";
const rotatedPassword = "CampusFixJourneyRotated2026";

async function createAccountAndVerifyDesktop(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "I’m new to CampusFix" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create secure account" }).click();
  await page.getByText("Account created", { exact: true }).waitFor();
  await page.locator(".account-desktop-sidebar .account-sidebar").waitFor();
  await page.screenshot({ path: "/home/ubuntu/account-verification-desktop-dashboard.png", fullPage: true });

  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("heading", { name: "Your CampusFix profile." }).waitFor();
  await page.getByLabel("Department").fill("Computing");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByText("Saved").waitFor();
  await page.getByLabel("Current password").fill("IncorrectJourneyPass2026");
  await page.getByLabel("New password", { exact: true }).fill(rotatedPassword);
  await page.getByLabel("Confirm new password", { exact: true }).fill(rotatedPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.locator(".profile-error").waitFor();
  await page.getByLabel("Current password").fill(password);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.getByText("Password updated. Other devices are signed out.").waitFor();
  password = rotatedPassword;
  await page.screenshot({ path: "/home/ubuntu/account-verification-desktop-profile.png", fullPage: true });

  await page.locator(".account-desktop-sidebar").getByRole("button", { name: "Dashboard" }).click();
  await page.locator(".support-shell").waitFor();
  await page.locator(".account-desktop-sidebar").getByLabel("Sign out").click();
  await page.getByRole("heading", { name: "How would you like to continue?" }).waitFor();
  await page.close();
}

async function verifyMobileLoginAndNavigation(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "I’m an existing user" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in to CampusFix" }).click();
  await page.getByText("Signed in successfully", { exact: true }).waitFor();
  await page.getByLabel("Open account navigation").waitFor();
  await page.screenshot({ path: "/home/ubuntu/account-verification-mobile-dashboard.png", fullPage: true });

  await page.getByLabel("Open account navigation").click();
  await page.locator(".account-mobile-drawer.is-open").waitFor();
  await page.waitForTimeout(320);
  await page.screenshot({ path: "/home/ubuntu/account-verification-mobile-navigation.png", fullPage: true });
  await page.locator(".account-mobile-panel").getByRole("button", { name: "Profile" }).click();
  await page.getByRole("heading", { name: "Your CampusFix profile." }).waitFor();
  await page.screenshot({ path: "/home/ubuntu/account-verification-mobile-profile.png", fullPage: true });
  await page.getByLabel("Open account navigation").click();
  await page.locator(".account-mobile-drawer.is-open").getByLabel("Sign out").click();
  await page.getByRole("heading", { name: "How would you like to continue?" }).waitFor();
  await page.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await createAccountAndVerifyDesktop(browser);
  await verifyMobileLoginAndNavigation(browser);
  console.log(JSON.stringify({ status: "passed", username, screenshots: 5 }));
} finally {
  await browser.close();
}

import { APIRequestContext, expect, Page } from "@playwright/test";
import { BASE_URL } from "./fixtures";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

// The emails the server (server.ts) kept for an address, oldest first, once
// there is one whose subject contains `subject`: the mail goes out after the
// request answers, so it is waited for.
export async function waitForMail(request: APIRequestContext, to: string, subject: string): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        const mails = (await (await request.get(`${BASE_URL}/__e2e/mails`, { params: { to } })).json()) as Mail[];
        found = mails.find((mail) => mail.subject.includes(subject));
        return found !== undefined;
      },
      { message: `an email "${subject}" to ${to}` }
    )
    .toBe(true);
  return found!;
}

// The link in an email's text.
export function linkIn(mail: Mail): string {
  return mail.text.match(/https?:\/\/\S+/)![0];
}

// Signs in through the login page.
export async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

// An account that exists and is confirmed, made the way a visitor does but
// through the API: the specs that are not about signing up start from it.
export async function createConfirmedAccount(request: APIRequestContext, email: string, password: string): Promise<void> {
  // The server only takes the accounts' requests from its own origin.
  const headers = { Origin: BASE_URL };
  const registered = await request.post(`${BASE_URL}/api/auth/register`, { data: { email, password }, headers });
  expect(registered.ok()).toBe(true);
  const mail = await waitForMail(request, email, "Confirmez");
  const token = new URL(linkIn(mail)).searchParams.get("token");
  const verified = await request.post(`${BASE_URL}/api/auth/verify-email`, { data: { token }, headers });
  expect(verified.ok()).toBe(true);
}

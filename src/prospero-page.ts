import { chromium } from "playwright-core";

import {
  getProsperoLoginUrl,
  loadProsperoSessionState,
  resolveBrowserPath,
  resolveProsperoUserDataDir,
  saveProsperoSessionState,
} from "./prospero-browser.js";
import type {
  ProsperoBrowserPageSnapshot,
  ProsperoRecordPage,
  ProsperoRecordSection,
  ProsperoRecordSectionItem,
  ProsperoRegisterChecklistResult,
  ProsperoRegistrationStartResult,
} from "./types.js";

export async function fetchProsperoRecordPage(accessionNumber: string): Promise<ProsperoRecordPage> {
  const { browser, context } = await launchProsperoContext(true);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const recordUrl = buildRecordUrl(accessionNumber);
    await page.goto(recordUrl, { waitUntil: "networkidle", timeout: 120_000 });
    await page.waitForSelector(".page-inner-restrict.publicdocument", { timeout: 120_000 });

    const snapshot = await extractPublicDocumentSnapshot(page);
    if (!snapshot) {
      throw new Error("PROSPERO page rendered but the publicdocument root was missing");
    }

    return {
      accession_number: normalizeAccession(accessionNumber),
      record_url: recordUrl,
      title: snapshot.title,
      authors: snapshot.authors,
      citation: snapshot.citation,
      sections: snapshot.sections.map(normalizeSection),
      raw_html_length: snapshot.htmlLength,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function startProsperoRegistration(): Promise<ProsperoRegistrationStartResult> {
  const { browser, context } = await launchProsperoContext(true);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const requestedUrl = "https://www.crd.york.ac.uk/PROSPERO/reviewcoversheet";
    await page.goto(requestedUrl, { waitUntil: "networkidle", timeout: 120_000 });

    const snapshot = await extractBrowserSnapshot(page, requestedUrl);
    const nextSteps = buildNextSteps(snapshot);

    return {
      ...snapshot,
      next_steps: nextSteps,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function openProsperoMyProspero(): Promise<ProsperoBrowserPageSnapshot> {
  const { browser, context } = await launchProsperoContext(true);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const requestedUrl = "https://www.crd.york.ac.uk/PROSPERO/myprospero";
    await page.goto(requestedUrl, { waitUntil: "networkidle", timeout: 120_000 });
    await page.locator("body").getByText("My PROSPERO", { exact: true }).first().waitFor({
      timeout: 30_000,
    }).catch(() => {});
    return extractBrowserSnapshot(page, requestedUrl);
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function openProsperoLoginBrowser(): Promise<void> {
  const browserPath = await resolveBrowserPath();
  const userDataDir = resolveProsperoUserDataDir();
  const browser = await chromium.launchPersistentContext(userDataDir, {
    executablePath: browserPath,
    headless: false,
    viewport: { width: 1440, height: 2200 },
  });

  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto(getProsperoLoginUrl(), { waitUntil: "networkidle", timeout: 120_000 });
    await page.bringToFront().catch(() => {});
    try {
      await page.waitForFunction(
        () => Boolean(sessionStorage.getItem("token") && sessionStorage.getItem("user")),
        undefined,
        { timeout: 0 },
      );
      const session = await page.evaluate(() => ({
        token: sessionStorage.getItem("token") ?? "",
        user: sessionStorage.getItem("user") ?? "",
      }));
      saveProsperoSessionState(session.token, session.user);
    } catch (error) {
      if (!page.isClosed()) throw error;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function fetchProsperoRegisterChecklist(): Promise<ProsperoRegisterChecklistResult> {
  const { browser, context } = await launchProsperoContext(true);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const requestedUrl = "https://www.crd.york.ac.uk/PROSPERO/register";
    await navigateToFirstEditableRecord(page);

    const snapshot = await extractBrowserSnapshot(page, requestedUrl);
    if (snapshot.login_required) {
      return {
        ...snapshot,
        page_heading: "",
        banner_text: "",
        action_buttons: [],
        sections: [],
      };
    }

    const checklist = await extractRegisterChecklist(page);
    return {
      ...snapshot,
      ...checklist,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function navigateToFirstEditableRecord(page: import("playwright-core").Page): Promise<void> {
  const dashboardUrl = "https://www.crd.york.ac.uk/PROSPERO/myprospero";
  await page.goto(dashboardUrl, { waitUntil: "networkidle", timeout: 120_000 });

  if (detectLoginRequired(page.url(), await page.title().catch(() => ""), await page.locator("body").innerText().catch(() => ""))) {
    return;
  }

  const editableRecord = page.locator("td.showcursor").first();
  await editableRecord.waitFor({ timeout: 30_000 }).catch(() => {});
  if ((await editableRecord.count()) === 0) {
    throw new Error("No editable PROSPERO draft was found in My PROSPERO");
  }

  await editableRecord.click();
  const editButton = page.getByText("Edit this version", { exact: true });
  await editButton.waitFor({ timeout: 30_000 });
  await editButton.click();
  await page.locator(".page-inner-restrict.pb-3 .accordion-item").first().waitFor({
    timeout: 30_000,
  });
}

async function extractBrowserSnapshot(
  page: import("playwright-core").Page,
  requestedUrl: string,
): Promise<ProsperoBrowserPageSnapshot> {
  const title = await page.title().catch(() => "");
  const finalUrl = page.url();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const htmlLength = await page.content().then((html) => html.length).catch(() => 0);
  const loginRequired = detectLoginRequired(finalUrl, title, bodyText);

  return {
    requested_url: requestedUrl,
    final_url: finalUrl,
    title: cleanText(title),
    body_text: cleanText(bodyText),
    html_length: htmlLength,
    login_required: loginRequired,
  };
}

async function extractPublicDocumentSnapshot(page: import("playwright-core").Page) {
  const extractor = new Function(`
    const root = document.querySelector(".page-inner-restrict.publicdocument");
    if (!root) return null;

    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const title = clean(root.querySelector(".prosperocitation-title")?.textContent || "");
    const authors = clean(root.querySelector(".prosperocitation-authors")?.textContent || "");
    const citation = clean(root.querySelector(".boxme > div:nth-child(3) p")?.textContent || "");

    const sections = Array.from(root.querySelectorAll(":scope > .section")).map((section) => {
      const h1 = clean(section.querySelector(":scope > h1")?.textContent || "");
      const items = Array.from(section.querySelectorAll(":scope > div")).map((block) => {
        const h2 = clean(block.querySelector(":scope > h2")?.textContent || "");
        const html = String(block.innerHTML || "").trim();
        return {
          title: h2,
          content: clean(block.textContent || ""),
          html,
        };
      });
      return { title: h1, items };
    });

    return {
      title,
      authors,
      citation,
      sections,
      htmlLength: root.innerHTML.length,
    };
  `) as () => {
    title: string;
    authors: string;
    citation: string;
    sections: Array<{ title: string; items: ProsperoRecordSectionItem[] }>;
    htmlLength: number;
  } | null;

  return page.evaluate(extractor);
}

function detectLoginRequired(finalUrl: string, title: string, bodyText: string): boolean {
  const haystack = `${finalUrl}\n${title}\n${bodyText}`.toLowerCase();
  return haystack.includes("login") || haystack.includes("sign in") || haystack.includes("log in");
}

function buildNextSteps(snapshot: ProsperoBrowserPageSnapshot): string[] {
  if (snapshot.login_required) {
    return [
      "登入 PROSPERO 後再重試這個工具。",
      "登入成功後，reviewcoversheet 會進入註冊流程；若需要，我可以再幫你抓下一步畫面。",
    ];
  }

  return [
    "目前頁面已不是登入頁，可以繼續選擇 review type 或填寫 coversheet。",
    "如果你要我繼續往下抓，我可以把下一頁內容也整理成結構化資料。",
  ];
}

async function extractRegisterChecklist(page: import("playwright-core").Page): Promise<
  Pick<
    ProsperoRegisterChecklistResult,
    "page_heading" | "banner_text" | "action_buttons" | "sections"
  >
> {
  const extractor = new Function(`
    const root = document.querySelector(".page-inner-restrict.pb-3");
    if (!root) return null;

    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const pageHeading = clean(root.querySelector(".plaintext.row h1")?.textContent || "");
    const bannerText = clean(root.querySelector(".helptextinline")?.textContent || "");
    const actionButtons = Array.from(root.querySelectorAll(".plaintext.row button"))
      .map((button) => clean(button.textContent || ""))
      .filter(Boolean);

    const sections = Array.from(root.querySelectorAll(".accordion-item")).map((item) => {
      const headerButton = item.querySelector(".accordion-header button");
      const title = clean(headerButton?.childNodes?.[0]?.textContent || headerButton?.textContent || "");
      const expanded = String(headerButton?.getAttribute("aria-expanded") || "").toLowerCase() === "true";
      const progress = Array.from(item.querySelectorAll(".accordion-progress .progress [role='progressbar']")).map((bar) => ({
        value_now: bar.getAttribute("aria-valuenow") ? Number(bar.getAttribute("aria-valuenow")) : null,
        value_max: bar.getAttribute("aria-valuemax") ? Number(bar.getAttribute("aria-valuemax")) : null,
        class_name: clean(bar.className || ""),
        width: clean(bar.getAttribute("style") || ""),
      }));
      const introText = clean(item.querySelector(".accordion-body > div")?.textContent || "");
      const items = Array.from(item.querySelectorAll(".accordion-body .list-group-item")).map((row) => {
        const title = clean(row.querySelector(".fw-bold")?.textContent || "");
        const status = clean(row.querySelector("span")?.textContent || "");
        const active = row.classList.contains("active");
        return {
          title,
          status,
          active,
          html: String(row.innerHTML || "").trim(),
        };
      });

      return {
        title,
        expanded,
        progress,
        intro_text: introText,
        items,
      };
    });

    return { page_heading: pageHeading, banner_text: bannerText, action_buttons: actionButtons, sections };
  `) as () => {
    page_heading: string;
    banner_text: string;
    action_buttons: string[];
    sections: Array<{
      title: string;
      expanded: boolean;
      progress: Array<{
        value_now: number | null;
        value_max: number | null;
        class_name: string;
        width: string;
      }>;
      intro_text: string;
      items: Array<{
        title: string;
        status: string;
        active: boolean;
        html: string;
      }>;
    }>;
  } | null;

  const result = await page.evaluate(extractor);
  if (!result) {
    throw new Error("PROSPERO register page rendered but the checklist root was missing");
  }

  return result;
}

function normalizeSection(section: { title: string; items: ProsperoRecordSectionItem[] }): ProsperoRecordSection {
  return {
    title: section.title,
    items: section.items.filter((item) => item.title.length > 0 || item.content.length > 0),
  };
}

async function launchProsperoContext(headless: boolean) {
  const browserPath = await resolveBrowserPath();
  const userDataDir = resolveProsperoUserDataDir();
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: browserPath,
    headless,
    viewport: { width: 1440, height: 2200 },
  });
  const session = loadProsperoSessionState();
  if (session) {
    await context.addInitScript(
      ({ token, user }) => {
        sessionStorage.setItem("token", token);
        sessionStorage.setItem("user", user);
      },
      { token: session.token, user: session.user },
    );
  }
  return { browser: context, context };
}

function buildRecordUrl(accessionNumber: string): string {
  const normalized = normalizeAccession(accessionNumber);
  return `https://www.crd.york.ac.uk/PROSPERO/view/${normalized}`;
}

function normalizeAccession(accessionNumber: string): string {
  const value = accessionNumber.trim();
  return value.toUpperCase();
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

import {
  getProsperoLoginUrl,
  loadProsperoSessionState,
  resolveBrowserPath,
  resolveProsperoUserDataDir,
  saveProsperoSessionState,
} from "./prospero-browser.js";
import { ProsperoError } from "./errors.js";
import { withRetry } from "./retry.js";
import type { RegistrationPatch } from "./registration-patch.js";
import { parsePublicDocumentHtml, parseRegisterChecklistHtml } from "./prospero-html.js";
import type {
  ProsperoBrowserPageSnapshot,
  ProsperoRecordPage,
  ProsperoRecordSection,
  ProsperoRecordSectionItem,
  ProsperoRegisterChecklistResult,
  ProsperoRegistrationStartResult,
  ProsperoDraft,
  ProsperoDraftSelector,
  ProsperoRegistrationSchema,
  ProsperoRegistrationSchemaField,
} from "./types.js";
import { assertExternalNetworkAllowed } from "./safety-policy.js";

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
  const { chromium } = await import("playwright-core");
  assertExternalNetworkAllowed("prospero");
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
    await navigateToEditableRecord(page, {});

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

export async function listProsperoDrafts(): Promise<ProsperoDraft[]> {
  const { browser, context } = await launchProsperoContext(true);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    return await loadDraftsInPage(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function fetchProsperoRegistrationSchema(
  selector: ProsperoDraftSelector,
  options: { include_details?: boolean; max_detail_fields?: number; detail_field_titles?: string[] } = {},
): Promise<ProsperoRegistrationSchema> {
  const { browser, context } = await launchProsperoContext(true);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const draft = await navigateToEditableRecord(page, selector);
    const checklist = await extractRegisterChecklist(page);
    const sections: ProsperoRegistrationSchema["sections"] = checklist.sections.map((section) => ({
      title: section.title,
      intro_text: section.intro_text,
      fields: section.items.map((item) => ({
        section: section.title,
        title: item.title,
        status: item.status,
        route: null,
        instructions: null,
        required: null,
        minimum_words: null,
        maximum_words: null,
        controls: [],
        detail_captured: false,
      })),
    }));

    if (options.include_details) {
      const maximum = Math.max(0, Math.trunc(options.max_detail_fields ?? Number.MAX_SAFE_INTEGER));
      const requestedTitles = new Set((options.detail_field_titles ?? []).map((title) => title.toLowerCase()));
      let captured = 0;
      for (let sectionIndex = 0; sectionIndex < sections.length && captured < maximum; sectionIndex += 1) {
        const targetSection = sections[sectionIndex]!;
        for (let fieldIndex = 0; fieldIndex < targetSection.fields.length && captured < maximum; fieldIndex += 1) {
          if (requestedTitles.size > 0 && !requestedTitles.has(targetSection.fields[fieldIndex]!.title.toLowerCase())) continue;
          await ensureRegisterPage(page, draft);
          const accordion = page.locator(".accordion-item").nth(sectionIndex);
          const header = accordion.locator(".accordion-header button");
          if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
          const row = accordion.locator(".list-group-item").nth(fieldIndex);
          await row.click();
          await page.waitForURL(/\/PROSPERO\/register\//, { timeout: 30_000 });
          await page.getByRole("button", { name: "Save for later", exact: true }).waitFor({ timeout: 60_000 });
          await page.waitForFunction(
            new Function("return !document.body.innerText.includes('Loading...')") as () => boolean,
            undefined,
            { timeout: 60_000 },
          );
          targetSection.fields[fieldIndex] = await extractRegistrationFieldDetail(
            page,
            targetSection.title,
            targetSection.fields[fieldIndex]!.title,
            targetSection.fields[fieldIndex]!.status,
          );
          captured += 1;
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
        }
      }
    }

    const fields = sections.flatMap((section) => section.fields);
    return {
      captured_at: new Date().toISOString(),
      source: "live",
      draft,
      sections,
      total_fields: fields.length,
      detailed_fields: fields.filter((field) => field.detail_captured).length,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function applyProsperoRegistrationPatch(
  patch: RegistrationPatch,
  allowedFields: string[],
): Promise<Array<{ key: string; status: "saved" | "skipped" }>> {
  const allowlist = new Set(allowedFields);
  const requested = patch.changes.filter((change) => change.changed);
  const disallowed = requested.filter((change) => !allowlist.has(change.key));
  if (disallowed.length) {
    throw new ProsperoError({
      code: "WRITE_CONFIRMATION_REQUIRED",
      message: "The patch contains changed fields outside the explicit allowlist.",
      retryable: false,
      action: "Review the dry-run and explicitly allow every field that may be saved.",
      details: { disallowed_fields: disallowed.map((change) => change.key) },
    });
  }

  const { browser, context } = await launchProsperoContext(true);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const currentDraft = await navigateToEditableRecord(page, { record_version_id: patch.draft.record_version_id });
    if (currentDraft.last_edited_at !== patch.draft.last_edited_at) {
      throw new ProsperoError({
        code: "WRITE_CONFIRMATION_REQUIRED",
        message: "The draft changed after the dry-run patch was prepared.",
        retryable: false,
        action: "Prepare a new patch from the current draft before saving.",
        details: { expected_last_edited_at: patch.draft.last_edited_at, current_last_edited_at: currentDraft.last_edited_at },
      });
    }

    const outcomes: Array<{ key: string; status: "saved" | "skipped" }> = [];
    for (const change of patch.changes) {
      if (!change.changed) {
        outcomes.push({ key: change.key, status: "skipped" });
        continue;
      }
      await ensureRegisterPage(page, currentDraft);
      const row = page.locator(".list-group-item").filter({ hasText: change.title }).first();
      await row.waitFor({ timeout: 30_000 });
      await row.click();
      await page.waitForURL((url) => url.pathname === change.route, { timeout: 30_000 });
      await page.getByRole("button", { name: "Save for later", exact: true }).waitFor({ timeout: 60_000 });
      const currentValue = await readLiveFieldValue(page);
      if (normalizeFieldValue(currentValue) !== normalizeFieldValue(change.current_value)) {
        throw new ProsperoError({
          code: "WRITE_CONFIRMATION_REQUIRED",
          message: `The current value of ${change.title} no longer matches the dry-run.`,
          retryable: false,
          action: "Prepare and review a new patch before saving.",
          details: { field: change.key },
        });
      }
      await fillLiveField(page, change.new_value, change.key);
      await page.getByRole("button", { name: "Save for later", exact: true }).click();
      await page.locator(".page-inner-restrict.pb-3 .accordion-item").first().waitFor({ timeout: 60_000 });
      outcomes.push({ key: change.key, status: "saved" });
    }
    return outcomes;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function navigateToEditableRecord(
  page: import("playwright-core").Page,
  selector: ProsperoDraftSelector,
): Promise<ProsperoDraft> {
  const drafts = await loadDraftsInPage(page);
  const editable = drafts.filter((draft) => draft.editable);
  const draft = resolveDraftSelector(editable, selector);

  const titleMatches = editable.filter((candidate) => candidate.title === draft.title);
  const occurrence = titleMatches.findIndex((candidate) => candidate.record_version_id === draft.record_version_id);
  const titleCell = page.locator("td[data-header='Review']").filter({ hasText: draft.title }).nth(Math.max(0, occurrence));
  await titleCell.waitFor({ timeout: 30_000 });
  await titleCell.click();
  const editButton = page.getByText("Edit this version", { exact: true });
  await editButton.waitFor({ timeout: 30_000 });
  await editButton.click();
  await page.locator(".page-inner-restrict.pb-3 .accordion-item").first().waitFor({ timeout: 30_000 });
  return draft;
}

async function loadDraftsInPage(page: import("playwright-core").Page): Promise<ProsperoDraft[]> {
  const dashboardUrl = "https://www.crd.york.ac.uk/PROSPERO/myprospero";
  return withRetry(async () => {
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/PROSPERO/api/record/getuserrecordlist") && response.status() === 200,
      { timeout: 90_000 },
    );
    await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (detectLoginRequired(page.url(), await page.title().catch(() => ""), bodyText)) {
      throw new ProsperoError({
        code: "AUTH_REQUIRED",
        message: "PROSPERO redirected the draft dashboard to login.",
        retryable: false,
        action: "Run prospero-mcp-login and retry.",
      });
    }
    let response: import("playwright-core").Response;
    try {
      response = await responsePromise;
    } catch (error) {
      throw new ProsperoError({
        code: "NETWORK_TIMEOUT",
        message: "PROSPERO did not return the user's record list.",
        retryable: true,
        action: "Retry after the PROSPERO dashboard API recovers.",
      }, { cause: error });
    }
    const payload = await response.json() as { results?: unknown[] };
    if (!Array.isArray(payload.results)) {
      throw new ProsperoError({
        code: "INVALID_RESPONSE",
        message: "PROSPERO returned an invalid draft-list response.",
        retryable: false,
        action: "Check whether the PROSPERO dashboard API changed.",
      });
    }
    const drafts = payload.results.map(normalizeDraft);
    if (drafts.some((draft) => draft.editable)) {
      await page.locator("td[data-header='Review']").first().waitFor({ timeout: 30_000 });
    }
    return drafts;
  });
}

function normalizeDraft(value: unknown): ProsperoDraft {
  const item = isRecord(value) ? value : {};
  const editingStatus = stringValue(item.EditingStatus);
  return {
    record_id: numberValue(item.RecordID),
    accession_number: stringValue(item.CRDAccessionNumber),
    record_version_id: stringValue(item.RecordVersionID),
    template_id: stringValue(item.RecordTemplateID),
    template_variant: stringValue(item.RecordTemplateVariant),
    purpose: stringValue(item.Purpose),
    publication_status: stringValue(item.PublicationStatus),
    editing_status: editingStatus,
    title: cleanText(stringValue(item.Title)) || "Untitled",
    created_at: stringValue(item.utcDateCreated),
    last_edited_at: stringValue(item.utcDateLastEdited),
    editable: editingStatus.toLowerCase() === "in process",
  };
}

function resolveDraftSelector(drafts: ProsperoDraft[], selector: ProsperoDraftSelector): ProsperoDraft {
  if (drafts.length === 0) {
    throw new ProsperoError({
      code: "NO_DRAFT",
      message: "No editable PROSPERO draft was found.",
      retryable: false,
      action: "Create a draft in My PROSPERO or select a record that is still editable.",
    });
  }

  const hasSelector = selector.record_id !== undefined || selector.record_version_id !== undefined || selector.title !== undefined;
  if (!hasSelector) {
    if (drafts.length === 1) return drafts[0]!;
    throw new ProsperoError({
      code: "DRAFT_SELECTION_REQUIRED",
      message: `There are ${drafts.length} editable drafts; no draft was selected.`,
      retryable: false,
      action: "Call prospero_list_drafts, then provide record_id or record_version_id.",
      details: { available_record_ids: drafts.map((draft) => draft.record_id) },
    });
  }

  const matches = drafts.filter((draft) =>
    (selector.record_id === undefined || draft.record_id === selector.record_id) &&
    (selector.record_version_id === undefined || draft.record_version_id.toLowerCase() === selector.record_version_id.toLowerCase()) &&
    (selector.title === undefined || draft.title === selector.title)
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new ProsperoError({
      code: "DRAFT_SELECTION_REQUIRED",
      message: "The draft selector matched more than one record.",
      retryable: false,
      action: "Use record_id or record_version_id instead of title.",
      details: { matching_record_ids: matches.map((draft) => draft.record_id) },
    });
  }
  throw new ProsperoError({
    code: "DRAFT_NOT_FOUND",
    message: "The selected editable draft was not found.",
    retryable: false,
    action: "Call prospero_list_drafts and select a current record identifier.",
  });
}

async function ensureRegisterPage(page: import("playwright-core").Page, draft: ProsperoDraft): Promise<void> {
  if (await page.locator(".page-inner-restrict.pb-3 .accordion-item").first().isVisible().catch(() => false)) return;
  await navigateToEditableRecord(page, { record_version_id: draft.record_version_id });
}

async function extractRegistrationFieldDetail(
  page: import("playwright-core").Page,
  section: string,
  title: string,
  status: string,
): Promise<ProsperoRegistrationSchemaField> {
  const extractor = new Function(
    "args",
    String.raw`
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
      const body = document.body?.innerText ?? "";
      const start = body.indexOf("Register a review");
      const endCandidates = [body.indexOf("Save for later"), body.indexOf("Disclaimer")].filter((value) => value > start);
      const end = endCandidates.length ? Math.min(...endCandidates) : body.length;
      const instructions = body.slice(start >= 0 ? start + "Register a review".length : 0, end).trim();
      const controls = Array.from(document.querySelectorAll("input,textarea,select,[contenteditable='true']")).map((element) => {
        const id = element.getAttribute("id") ?? "";
        const label = id ? document.querySelector("label[for='" + CSS.escape(id) + "']") : null;
        const group = element.closest(".mb-3,.form-group,.radiobox,.checkbox,fieldset");
        const options = element.tagName === "SELECT"
          ? Array.from(element.options).map((option) => clean(option.textContent)).filter(Boolean)
          : [];
        return {
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type") ?? "",
          name: element.getAttribute("name") ?? "",
          id,
          label: clean(label?.textContent),
          required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
          placeholder: element.getAttribute("placeholder") ?? "",
          options,
          context: clean(group?.innerText).slice(0, 1500),
          value: element.getAttribute("contenteditable") === "true" ? clean(element.innerText) : String(element.value ?? ""),
          checked: typeof element.checked === "boolean" ? element.checked : null,
        };
      });
      const wordMatch = body.match(/minimum\s+(\d+),\s+maximum\s+(\d+)/i);
      return {
        section: args.section,
        title: args.title,
        status: args.status,
        route: location.pathname,
        instructions,
        required: /\*\s*required|required\)/i.test(body) || controls.some((control) => control.required),
        minimum_words: wordMatch ? Number(wordMatch[1]) : null,
        maximum_words: wordMatch ? Number(wordMatch[2]) : null,
        controls,
        detail_captured: true,
      };
    `,
  ) as (args: { section: string; title: string; status: string }) => ProsperoRegistrationSchemaField;
  return page.evaluate(extractor, { section, title, status });
}

async function readLiveFieldValue(page: import("playwright-core").Page): Promise<string> {
  const extractor = new Function(String.raw`
    const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
    const selected = Array.from(document.querySelectorAll("input[type='radio']:checked,input[type='checkbox']:checked"))
      .map((element) => {
        const id = element.getAttribute("id") ?? "";
        return clean(id ? document.querySelector("label[for='" + CSS.escape(id) + "']")?.textContent : element.value);
      }).filter(Boolean);
    if (selected.length) return selected.join("; ");
    const editors = Array.from(document.querySelectorAll("[contenteditable='true']"))
      .map((element) => clean(element.innerText)).filter(Boolean);
    if (editors.length) return editors.join("\n");
    const textValues = Array.from(document.querySelectorAll("textarea,input:not([type]),input[type='text'],input[type='email'],input[type='url'],input[type='date']"))
      .map((element) => String(element.value ?? "").trim()).filter(Boolean);
    if (textValues.length) return textValues.join("\n");
    const selectValues = Array.from(document.querySelectorAll("select"))
      .map((element) => clean(element.selectedOptions?.[0]?.textContent)).filter(Boolean);
    return selectValues.join("; ");
  `) as () => string;
  return page.evaluate(extractor);
}

async function fillLiveField(
  page: import("playwright-core").Page,
  newValue: string,
  fieldKey: string,
): Promise<void> {
  const editor = page.locator("[contenteditable='true']").first();
  if (await editor.isVisible().catch(() => false)) {
    await editor.fill(newValue);
    return;
  }
  const textarea = page.locator("textarea").first();
  if (await textarea.isVisible().catch(() => false)) {
    await textarea.fill(newValue);
    return;
  }
  const textInput = page.locator("input:not([type]),input[type='text'],input[type='email'],input[type='url'],input[type='date']").first();
  if (await textInput.isVisible().catch(() => false)) {
    await textInput.fill(newValue);
    return;
  }
  const select = page.locator("select").first();
  if (await select.isVisible().catch(() => false)) {
    await select.selectOption({ label: newValue }).catch(async () => select.selectOption(newValue));
    return;
  }
  const label = page.getByText(newValue, { exact: true }).filter({ visible: true }).first();
  if (await label.isVisible().catch(() => false)) {
    await label.click();
    return;
  }
  throw new ProsperoError({
    code: "UNSUPPORTED_FIELD",
    message: `No guarded editor is implemented for ${fieldKey}.`,
    retryable: false,
    action: "Enter this field manually or add a tested field-specific adapter.",
  });
}

function normalizeFieldValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  return parsePublicDocumentHtml(await page.content());
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
  return parseRegisterChecklistHtml(await page.content());
}

function normalizeSection(section: { title: string; items: ProsperoRecordSectionItem[] }): ProsperoRecordSection {
  return {
    title: section.title,
    items: section.items.filter((item) => item.title.length > 0 || item.content.length > 0),
  };
}

async function launchProsperoContext(headless: boolean) {
  const { chromium } = await import("playwright-core");
  assertExternalNetworkAllowed("prospero");
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

import { load } from "cheerio";

import { ProsperoError } from "./errors.js";
import type {
  ProsperoRecordSectionItem,
  ProsperoRegisterChecklistResult,
} from "./types.js";

export interface PublicDocumentSnapshot {
  title: string;
  authors: string;
  citation: string;
  sections: Array<{ title: string; items: ProsperoRecordSectionItem[] }>;
  htmlLength: number;
}

export function parsePublicDocumentHtml(html: string): PublicDocumentSnapshot {
  const $ = load(html);
  const root = $(".page-inner-restrict.publicdocument").first();
  if (!root.length) throw schemaChanged("publicdocument", html);

  const sections = root.children(".section").map((_index, sectionElement) => {
    const section = $(sectionElement);
    const items = section.children("div").map((_itemIndex, blockElement) => {
      const block = $(blockElement);
      return {
        title: cleanText(block.children("h2").first().text()),
        content: cleanText(block.text()),
        html: block.html()?.trim() ?? "",
      };
    }).get();
    return {
      title: cleanText(section.children("h1").first().text()),
      items,
    };
  }).get();

  const citationBlock = root.find(".boxme h2").filter((_index, element) => cleanText($(element).text()).startsWith("Citation")).first().parent();
  return {
    title: cleanText(root.find(".prosperocitation-title").first().text()),
    authors: cleanText(root.find(".prosperocitation-authors").first().text()),
    citation: cleanText(citationBlock.text().replace(/^Citation\s*/i, "")),
    sections,
    htmlLength: root.html()?.length ?? 0,
  };
}

export function parseRegisterChecklistHtml(html: string): Pick<
  ProsperoRegisterChecklistResult,
  "page_heading" | "banner_text" | "action_buttons" | "sections"
> {
  const $ = load(html);
  const root = $(".page-inner-restrict.pb-3").first();
  if (!root.length) throw schemaChanged("register checklist root", html);
  const accordions = root.find(".accordion-item");
  if (!accordions.length) throw schemaChanged("registration accordion", html);

  const actionButtons = root.find(".plaintext.row button").map((_index, element) => cleanText($(element).text())).get().filter(Boolean);
  const sections = accordions.map((_index, itemElement) => {
    const item = $(itemElement);
    const headerButton = item.find(".accordion-header button").first();
    const titleClone = headerButton.clone();
    titleClone.find(".accordion-progress").remove();
    const progress = item.find(".accordion-progress [role='progressbar']").map((_progressIndex, progressElement) => {
      const element = $(progressElement);
      return {
        value_now: numberOrNull(element.attr("aria-valuenow")),
        value_max: numberOrNull(element.attr("aria-valuemax")),
        class_name: cleanText(element.attr("class") ?? ""),
        width: cleanText(element.attr("style") ?? ""),
      };
    }).get();
    const body = item.find(".accordion-body").first();
    const fields = body.find(".list-group-item").map((_fieldIndex, rowElement) => {
      const row = $(rowElement);
      return {
        title: cleanText(row.find(".fw-bold").first().text()),
        status: cleanText(row.find("span").first().text()),
        active: row.hasClass("active"),
        html: row.html()?.trim() ?? "",
      };
    }).get();
    return {
      title: cleanText(titleClone.text()),
      expanded: headerButton.attr("aria-expanded")?.toLowerCase() === "true",
      progress,
      intro_text: cleanText(body.children("div").first().text()),
      items: fields,
    };
  }).get();

  return {
    page_heading: cleanText(root.find(".plaintext.row h1").first().text()),
    banner_text: cleanText(root.find(".helptextinline").first().text()),
    action_buttons: actionButtons,
    sections,
  };
}

function schemaChanged(expected: string, html: string): ProsperoError {
  const release = html.match(/Release version\s+([\d.]+)/i)?.[1] ?? null;
  return new ProsperoError({
    code: "SITE_SCHEMA_CHANGED",
    message: `PROSPERO rendered without the expected ${expected}.`,
    retryable: false,
    action: "Capture a sanitized fixture and update the parser selectors.",
    details: { expected, release_version: release, html_length: html.length },
  });
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

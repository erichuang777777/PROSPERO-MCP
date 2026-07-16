import assert from "node:assert/strict";
import test from "node:test";

import { buildProsperoPicoQuery, exportSearchHits, rankSearchHits } from "../src/search-automation.js";
import type { ProsperoHit } from "../src/types.js";

test("PICO query builder groups synonyms", () => {
  const query = buildProsperoPicoQuery({
    condition: ["breast cancer", "breast neoplasm*"],
    intervention: ["nurse-led care"],
    outcomes: ["pain"],
  });
  assert.equal(query, '("breast cancer" OR breast neoplasm*) AND ("nurse-led care") AND (pain)');
});

test("local relevance ranking and exports are deterministic", () => {
  const hits: ProsperoHit[] = [
    hit("CRD2", "Pancreatic surgery review"),
    hit("CRD1", "Breast cancer nursing intervention review"),
  ];
  const ranked = rankSearchHits(hits, ["breast cancer", "nursing"]);
  assert.equal(ranked[0]?.accession_number, "CRD1");
  assert.match(exportSearchHits(ranked, "csv"), /"CRD1"/);
  assert.match(exportSearchHits(ranked, "ris"), /UR  - https:\/\/www\.crd\.york\.ac\.uk\/PROSPERO\/view\/CRD1/);
});

function hit(accession: string, title: string): ProsperoHit {
  return {
    record_id: accession,
    accession_number: accession,
    title,
    review_status: "Ongoing",
    editing_status: "live",
    living_status: "standard",
    year_first_published: 2026,
    raw: {},
  };
}

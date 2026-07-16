import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PubMedClient, parsePubMedXml } from "../src/pubmed-client.js";

const fixture = readFileSync(path.resolve("test/fixtures/pubmed-articles.xml"), "utf8");

test("PubMed XML parser extracts traceable review metadata", () => {
  const records = parsePubMedXml(fixture);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.pmid, "12345678");
  assert.equal(records[0]?.doi, "10.1000/example");
  assert.match(records[0]?.abstract ?? "", /BACKGROUND:/);
  assert.deepEqual(records[0]?.authors, ["Jane Doe"]);
});

test("PubMed search works without an API key", async () => {
  const requested: string[] = [];
  const client = new PubMedClient({
    apiKey: "",
    minimumIntervalMs: 0,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("esearch.fcgi")) {
        return new Response(JSON.stringify({ esearchresult: { count: "1", idlist: ["12345678"] } }));
      }
      return new Response(fixture, { headers: { "content-type": "application/xml" } });
    },
  });
  const result = await client.searchReviews("breast cancer AND systematic[sb]", 10);
  assert.equal(result.total_hits, 1);
  assert.equal(result.records[0]?.pmid, "12345678");
  assert.equal(requested.every((url) => !url.includes("api_key=")), true);
  assert.equal(requested.some((url) => url.includes("tool=prospero-mcp")), true);
});

test("PubMed empty search does not call EFetch", async () => {
  let calls = 0;
  const client = new PubMedClient({
    minimumIntervalMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ esearchresult: { count: "0", idlist: [] } }));
    },
  });
  const result = await client.searchReviews("nonexistent review topic", 10);
  assert.equal(result.records.length, 0);
  assert.equal(calls, 1);
});

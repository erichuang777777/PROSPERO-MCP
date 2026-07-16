import test from "node:test";
import assert from "node:assert/strict";

import { buildFilters, normalizeSearchPage, ProsperoClient } from "../src/prospero-client.js";

test("normalizeSearchPage strips html and maps hits", () => {
  const page = normalizeSearchPage(
    [
      {
        linenumber: 1,
        term: "covid",
        hits: 1,
        note: { status: "ok" },
        retvals: {
          aggs: { reviewstatus: [{ key: "Ongoing", doc_count: 1 }] },
          hits: {
            total: { value: 1 },
            hits: [
              {
                _id: "1016642",
                _score: 1,
                _source: {
                  accessionnumber: "CRD420251016642",
                  title: "<p>Test title</p>",
                  reviewstatus: "Ongoing",
                  editingstatus: "live",
                  isliving: "standard",
                  yearfirstpublished: 2025,
                },
              },
            ],
          },
        },
      },
    ],
    1,
    20,
    "covid",
  );

  assert.equal(page.total_hits, 1);
  assert.equal(page.hits[0]?.title, "Test title");
  assert.equal(page.hits[0]?.accession_number, "CRD420251016642");
});

test("search sends the expected payload", async () => {
  const requests: Request[] = [];
  const originalFetch = global.fetch;
  const oldCache = process.env.PROSPERO_CACHE_ENABLED;
  process.env.PROSPERO_CACHE_ENABLED = "false";
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify([
        {
          linenumber: 1,
          term: "covid",
          hits: 0,
          note: { status: "ok" },
          retvals: { aggs: {}, hits: { total: { value: 0 }, hits: [] } },
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const client = new ProsperoClient({
      baseUrl: "https://www.crd.york.ac.uk/PROSPERO/api/",
      accessToken: "",
      authToken: "token",
      timeoutMs: 1000,
    });

    const result = await client.search({ query: "covid", page: 2, page_size: 5 });
    assert.equal(result.page, 2);
    assert.equal(requests.length, 1);

    const body = JSON.parse(await requests[0]!.text()) as Record<string, unknown>;
    assert.equal(body.term, "covid");
    assert.equal(body.actual, "covid");
    assert.equal(body.page, 2);
    assert.equal(body.nperpage, 5);
  } finally {
    global.fetch = originalFetch;
    if (oldCache === undefined) delete process.env.PROSPERO_CACHE_ENABLED; else process.env.PROSPERO_CACHE_ENABLED = oldCache;
  }
});

test("buildFilters maps convenience fields", () => {
  assert.deepEqual(
    buildFilters({
      query: "breast cancer",
      record_type: ["Clinical"],
      review_status: ["Ongoing"],
      year_in_prospero: ["2025", "2026"],
      date_registered_start: "1 July 2025",
      date_registered_end: "16 July 2026",
    }),
    [
      { name: "recordtype", value: ["Clinical"] },
      { name: "reviewstatus", value: ["Ongoing"] },
      { name: "yearfirstpublished", value: ["2025", "2026"] },
      { name: "dateinprospero", value: ["1 July 2025 to 16 July 2026"] },
    ],
  );
});

test("similar reviews check sends expected payload", async () => {
  const requests: Request[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(
      JSON.stringify({
        results: [
          {
            RecordID: 1181863,
            Title: "Breast Cancer Prediction Tests",
            ReviewQ: "What are the perceptions and influencing factors?",
            AccessionNumber: "CRD420251181863",
            DateFirstPublished: "2025",
            percent: 0.91,
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const client = new ProsperoClient({
      baseUrl: "https://www.crd.york.ac.uk/PROSPERO/api/",
      accessToken: "",
      authToken: "token",
      timeoutMs: 1000,
    });

    const result = await client.checkSimilarReviews({
      recordversion: 1181863,
      title: "Breast Cancer Prediction Tests",
      review_question: "What are the perceptions and influencing factors?",
    });

    assert.equal(result[0]?.accession_number, "CRD420251181863");
    assert.equal(requests.length, 1);
    const body = JSON.parse(await requests[0]!.text()) as Record<string, unknown>;
    assert.equal(body.recordversion, 1181863);
    assert.equal(body.title, "Breast Cancer Prediction Tests");
    assert.equal(body.rq, "What are the perceptions and influencing factors?");
    assert.equal(body.threshold, 0.4);
  } finally {
    global.fetch = originalFetch;
  }
});

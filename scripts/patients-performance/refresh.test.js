import { expect, it } from "vite-plus/test";
import { openFixture, archiveBaseline } from "./contract.cjs";
import { FIXTURE_BUDGET, rawDocuments } from "./raw-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_REQUEST } from "./snapshot-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { startApplication } from "./application.cjs";
import { openTransport } from "./mongo-transport.cjs";
import { BSON, MongoClient } from "mongodb";
import {
  HISTORY,
  CUTS,
  PAGE_CLOCK,
  CASES,
  documents,
  sealRefresh,
  page as refreshPage,
  comparable,
  seedBaseline,
} from "./refresh-fixture.cjs";

const CUT = "2024-01-09T04:00:00.000Z";
const ROUTES = ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];

async function page(app, body = SNAPSHOT_REQUEST) {
  return Promise.all(
    ROUTES.map(async (route) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        sourceCutAt: response.headers.get("x-ncd-source-cut"),
        state: response.headers.get("x-ncd-data-state"),
      };
    })
  );
}

it("runs a full immutable 11:00 Bangkok refresh and publishes one checked generation with separate source and phase times", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture(undefined, {
    manifestOverrides: {
      sourceCutAt: CUT,
      availability: {
        mutationAvailableThrough: CUT,
        exportAvailableAt: "2024-01-09T04:01:00.000Z",
        evidence: "finite-producer-availability-v1",
      },
    },
  });
  let now = new Date("2024-01-09T04:02:00.000Z");
  let app;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    const report = await builder.refresh(
      {
        cutAt: CUT,
        expectedActive: null,
        acquire: async ({ deadlineAt }) => {
          expect(new Date(deadlineAt).getTime()).toBeLessThanOrEqual(new Date("2024-01-09T06:02:00.000Z").getTime());
          expect(new Date(deadlineAt).getTime()).toBeGreaterThan(new Date("2024-01-09T06:01:59.000Z").getTime());
          now = new Date("2024-01-09T04:03:00.000Z");
          return cut.sourceCut;
        },
      },
      FIXTURE_BUDGET,
      { ...cut.comparisonContext, comparisonOnly: false }
    );
    expect(report.status).toBe("published");
    expect(report.source).toMatchObject({
      sourceCutAt: CUT,
      sourceVersion: "finite-domain-v1",
      mutationAvailableThrough: CUT,
      exportAvailableAt: "2024-01-09T04:01:00.000Z",
    });
    expect(report.ledger).toMatchObject({
      cutAt: CUT,
      deadlineAt: "2024-01-09T16:00:00.000Z",
      reserveLimitMS: 14400000,
      queueMS: 120000,
      acquisitionMS: 60000,
    });
    expect(report.ledger.reserveSpentMS).toBeGreaterThanOrEqual(120000);
    expect(report.candidate.complete).toBe(true);
    expect(report.visibility).toBe("unverified-frontend-deferred");
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-09T05:00:00.000Z" });
    const responses = await page(app);
    expect(
      responses.every(({ status, sourceCutAt, state }) => status === 200 && sourceCutAt === CUT && state === "fresh")
    ).toBe(true);
    expect(responses[0].body.result).toEqual([
      { service_count: 9, patient_count: 6, expense: 370, hcode_count: 2, avg_service: 1.5, avg_expense: 61.67 },
    ]);
  } finally {
    await app?.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("preserves the old six-response page after signed-source, acquisition, history and ETL failures without granting a retry new time", async () => {
  const fixture = await openFixture();
  const previous = sealSnapshotFixture(undefined, { manifestOverrides: { sourceCutAt: "2024-01-08T04:00:00.000Z" } });
  const contexts = [
    { cutAt: CUT, overrides: { availability: undefined } },
    { cutAt: "2024-01-09T16:00:00.000Z", lateExport: true },
    { cutAt: "2024-01-10T04:00:00.000Z", acquisitionOverrun: true },
    {
      cutAt: "2024-01-10T16:00:00.000Z",
      overrides: { history: { start: "2024-01-08T00:00:00.000Z", end: "2024-01-08T23:59:59.999Z" } },
    },
    { cutAt: "2024-01-11T04:00:00.000Z", invalidRaw: true },
  ];
  const cuts = contexts.map(({ cutAt, overrides, lateExport, invalidRaw }) =>
    sealSnapshotFixture(
      invalidRaw
        ? rawDocuments().map((row) => ({
            ...row,
            claim_date: new Date(row.claim_date.getTime() + 6 * 86400000),
            total: 12,
          }))
        : undefined,
      {
        manifestOverrides: {
          sourceCutAt: cutAt,
          availability: {
            mutationAvailableThrough: cutAt,
            exportAvailableAt: lateExport ? "2024-01-09T18:00:00.001Z" : cutAt,
            evidence: "finite-producer-availability-v1",
          },
          ...overrides,
        },
      }
    )
  );
  let now = new Date(CUT),
    app;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    const candidate = await builder.build(previous.sourceCut, FIXTURE_BUDGET, {
      ...previous.comparisonContext,
      comparisonOnly: false,
    });
    const active = await builder.publish(candidate, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-15T05:00:00.000Z" });
    const before = await page(app);
    for (const [index, cut] of cuts.entries()) {
      const scenario = contexts[index];
      now = new Date(new Date(scenario.cutAt).getTime() + 60000);
      const request = {
        cutAt: scenario.cutAt,
        expectedActive: active,
        acquire: async () => {
          if (scenario.acquisitionOverrun) now = new Date(new Date(now).getTime() + 7200001);
          return cut.sourceCut;
        },
      };
      const error = await builder
        .refresh(request, FIXTURE_BUDGET, {
          ...cut.comparisonContext,
          supportedHistory: previous.comparisonContext.supportedHistory,
          comparisonOnly: false,
        })
        .catch((error) => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.report.status).toBe("failed");
      if (scenario.invalidRaw) {
        expect(error.report.generationId).toMatch(/^[a-f0-9-]{36}$/);
        expect(error.report.completedStages.map(({ name }) => name)).toEqual([
          "source-staging",
          "source-type-inventory",
        ]);
      }
      expect(await page(app)).toEqual(before);
      let reacquired = false;
      await expect(
        builder.refresh(
          {
            ...request,
            acquire: async () => {
              reacquired = true;
              return cut.sourceCut;
            },
          },
          FIXTURE_BUDGET,
          { ...cut.comparisonContext, comparisonOnly: false }
        )
      ).rejects.toThrow();
      expect(reacquired).toBe(false);
    }
    expect(
      before.every(
        ({ status, sourceCutAt, state }) =>
          status === 200 && sourceCutAt === "2024-01-08T04:00:00.000Z" && state === "stale"
      )
    ).toBe(true);
  } finally {
    await app?.close();
    cuts.forEach((cut) => cut.close());
    previous.close();
    await fixture.close();
  }
}, 60000);

it("rebuilds full older history and corrected raw state into all six live and snapshot responses with obsolete contributions removed", async () => {
  const fixture = await openFixture();
  const baseline = archiveBaseline();
  const cuts = [sealRefresh(1), sealRefresh(2)];
  let legacy,
    optimized,
    now,
    active = null;
  try {
    legacy = await startApplication({ db: fixture.db, sourceRoot: baseline.sourceRoot, clock: PAGE_CLOCK });
    optimized = await startApplication({ db: fixture.db, activeGeneration: true, clock: PAGE_CLOCK });
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    for (const [index, cut] of cuts.entries()) {
      await seedBaseline(fixture.db, baseline, documents(index + 1), legacy);
      now = new Date(new Date(CUTS[index]).getTime() + 60000);
      const report = await builder.refresh(
        { cutAt: CUTS[index], expectedActive: active, acquire: async () => cut.sourceCut },
        FIXTURE_BUDGET,
        { ...cut.comparisonContext, comparisonOnly: false }
      );
      active = report.active;
      expect(report.candidate.source.history).toEqual(HISTORY);
      expect(report.candidate.validation.monthlyStored.categories).toBe(15);
      for (const [name, body] of CASES) {
        const reference = await refreshPage(legacy, body);
        expect(comparable(await refreshPage(legacy, body)), `stable baseline ${index + 1}/${name}`).toEqual(
          comparable(reference)
        );
        const actual = await refreshPage(optimized, body);
        expect(comparable(actual), `corrected raw cut ${index + 1}/${name}`).toEqual(comparable(reference));
        expect(
          actual.responses.every(
            ({ status, sourceCutAt, state }) =>
              status === 200 && sourceCutAt === CUTS[index] && state === (index === 0 ? "stale" : "fresh")
          )
        ).toBe(true);
        if (name === "hospital-H0")
          expect(actual.responses[0].body.result[0]).toEqual({
            service_count: 1,
            patient_count: 1,
            expense: index === 0 ? 5 : 50,
            hcode_count: 1,
            avg_service: 1,
            avg_expense: index === 0 ? 5 : 50,
          });
        if (name === "hospital-H3" && index === 1)
          expect(actual.responses[0].body.result[0]).toEqual({
            service_count: 0,
            patient_count: 0,
            expense: 0,
            hcode_count: 0,
            avg_service: 0,
            avg_expense: 0,
          });
        if (name === "full-supported-history") {
          expect(actual.responses[4].body.result.slice(0, 4).map(({ data }) => data[11])).toEqual([1, 1, 1, 1]);
          expect(actual.responses[5].body.result.slice(0, 5).map(({ data }) => data[11])).toEqual([
            index === 0 ? 2 : 1,
            1,
            1,
            1,
            1,
          ]);
        }
      }
    }
  } finally {
    await legacy?.close();
    await optimized?.close();
    cuts.forEach((cut) => cut.close());
    baseline.close();
    await fixture.close();
  }
}, 120000);

it("keeps fast graph work pinned while another actual HTTP consumer is still linking to it", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const cut = sealSnapshotFixture();
  let app, work, link, first, second;
  try {
    const builder = createBuilder({
      db: fixture.db,
      clock: () => new Date("2024-01-09T05:00:00.000Z"),
      timeZone: "UTC",
    });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      activeGeneration: true,
      clock: "2024-01-09T05:00:00.000Z",
      transportUri: transport.uri,
    });
    const request = async (route) => {
      const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ province: "P" }),
        signal: AbortSignal.timeout(15000),
      });
      return { status: response.status, body: await response.json(), source: response.headers.get("x-ncd-source-cut") };
    };
    const calculating = transport.arm((command) => command.find === "patients_month_scopes");
    first = request("graph-disease-pt");
    work = await calculating;
    let follower = false;
    const linking = transport.arm((command) => {
      if (
        command.update === "patients_model_control" &&
        command.updates[0].u.pins?.filter((pin) => pin.kind === "reader").length >= 2
      )
        follower = true;
      return follower && command.find === "patients_model_control";
    });
    second = request("graph-ca-pt");
    link = await linking;
    work.release();
    expect((await first).status).toBe(200);
    link.release();
    expect(await second).toMatchObject({ status: 200, source: "2024-01-09T05:00:00.000Z" });
  } finally {
    work?.release();
    link?.release();
    transport.release();
    await Promise.allSettled([Promise.resolve(first), Promise.resolve(second)]);
    await app?.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("charges ledger coordination to the same four-hour reserve before starting acquisition", async () => {
  const fixture = await openFixture();
  const cut = sealSnapshotFixture(undefined, {
    manifestOverrides: {
      sourceCutAt: CUT,
      availability: {
        mutationAvailableThrough: CUT,
        exportAvailableAt: CUT,
        evidence: "finite-producer-availability-v1",
      },
    },
  });
  let now = new Date("2024-01-09T07:59:59.999Z"),
    acquired = false;
  try {
    fixture.client.on("commandStarted", ({ command }) => {
      if (command.insert === "patients_refresh_runs") now = new Date("2024-01-09T08:00:00.001Z");
    });
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    await expect(
      builder.refresh(
        {
          cutAt: CUT,
          expectedActive: null,
          acquire: async () => {
            acquired = true;
            return cut.sourceCut;
          },
        },
        FIXTURE_BUDGET,
        { ...cut.comparisonContext, comparisonOnly: false }
      )
    ).rejects.toThrow();
    expect(acquired).toBe(false);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it.each([
  ["hold", "2024-01-09T10:03:00.001Z", "published-late"],
  ["lose", "2024-01-09T10:03:00.001Z", "published-late"],
  ["lose", "2024-01-09T16:00:00.001Z", "publication-uncertain"],
])(
  "reports a publication with a %s reply at %s as %s",
  async (action, replyTime, expectedStatus) => {
    const fixture = await openFixture();
    const transport = await openTransport();
    const client = new MongoClient(transport.uri);
    const previous = sealSnapshotFixture(undefined, { manifestOverrides: { sourceCutAt: "2024-01-08T04:00:00.000Z" } });
    const cut = sealSnapshotFixture(undefined, {
      manifestOverrides: {
        sourceCutAt: CUT,
        availability: {
          mutationAvailableThrough: CUT,
          exportAvailableAt: "2024-01-09T04:01:00.000Z",
          evidence: "finite-producer-availability-v1",
        },
      },
    });
    let now = new Date("2024-01-09T04:02:00.000Z"),
      pending,
      app;
    try {
      await client.connect();
      const builder = createBuilder({
        db: client.db(fixture.db.databaseName),
        clock: () => new Date(now),
        timeZone: "UTC",
      });
      const old = await builder.build(previous.sourceCut, FIXTURE_BUDGET, {
        ...previous.comparisonContext,
        comparisonOnly: false,
      });
      const active = await builder.publish(old, null);
      const reached = transport.arm(
        (command) =>
          command.update === "patients_model_control" &&
          command.updates[0].u.active?.generationId !== old.generationId &&
          command.updates[0].u.active,
        action
      );
      pending = builder.refresh(
        {
          cutAt: CUT,
          expectedActive: active,
          acquire: async () => {
            now = new Date("2024-01-09T04:03:00.000Z");
            return cut.sourceCut;
          },
        },
        FIXTURE_BUDGET,
        { ...cut.comparisonContext, comparisonOnly: false }
      );
      const outcome = pending.catch((error) => error.report);
      await reached;
      now = new Date(replyTime);
      transport.release();
      const report = await outcome;
      expect(report.status).toBe(expectedStatus);
      if (expectedStatus === "published-late") expect(report.active.generationId).toBe(report.candidate.generationId);
      else {
        expect(report.active).toBeUndefined();
        expect(report.ledgerPersistence).toBe("unverified");
      }
      app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-09T11:00:00.000Z" });
      expect(
        (await page(app, { startDate: "2024-01-07", endDate: "2024-01-08" })).every(
          ({ status, sourceCutAt }) => status === 200 && sourceCutAt === CUT
        )
      ).toBe(true);
    } finally {
      transport.release();
      await pending?.catch(() => {});
      await app?.close();
      await client.close();
      await transport.close();
      cut.close();
      previous.close();
      await fixture.close();
    }
  },
  60000
);

it("runs consecutive 11:00 and 23:00 cuts with safe two-slot reuse and one shared reserve", async () => {
  const fixture = await openFixture();
  const cuts = [CUT, "2024-01-09T16:00:00.000Z", "2024-01-10T04:00:00.000Z"].map((cutAt, index) =>
    sealSnapshotFixture(undefined, {
      manifestOverrides: {
        sourceCutAt: cutAt,
        sourceVersion: `normal-refresh-${index + 1}`,
        availability: {
          mutationAvailableThrough: cutAt,
          exportAvailableAt: cutAt,
          evidence: "finite-producer-availability-v1",
        },
      },
    })
  );
  let now = new Date(CUT),
    active = null,
    app;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    const reports = [];
    for (const cut of cuts) {
      const cutAt = BSON.deserialize(cut.sourceCut.manifest).sourceCutAt;
      now = new Date(new Date(cutAt).getTime() + 60000);
      const report = await builder.refresh(
        { cutAt, expectedActive: active, acquire: async () => cut.sourceCut },
        FIXTURE_BUDGET,
        { ...cut.comparisonContext, comparisonOnly: false }
      );
      active = report.active;
      reports.push(report);
    }
    expect(reports.map(({ status }) => status)).toEqual(["published", "published", "published"]);
    expect(reports[2].ledger.cleanupMS).toBeGreaterThan(0);
    expect(
      reports.every(({ ledger }) => ledger.reserveSpentMS >= ledger.queueMS && ledger.reserveLimitMS === 14400000)
    ).toBe(true);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-10T05:00:00.000Z" });
    expect(
      (await page(app, { startDate: "2024-01-07", endDate: "2024-01-08" })).map(({ status, sourceCutAt }) => [
        status,
        sourceCutAt,
      ])
    ).toEqual(Array.from({ length: 6 }, () => [200, "2024-01-10T04:00:00.000Z"]));
  } finally {
    await app?.close();
    cuts.forEach((cut) => cut.close());
    await fixture.close();
  }
}, 60000);

it("uses only the remaining build window for publication verification and stops before the conditional pointer change", async () => {
  const fixture = await openFixture();
  const previous = sealSnapshotFixture(undefined, { manifestOverrides: { sourceCutAt: "2024-01-08T04:00:00.000Z" } });
  const cut = sealSnapshotFixture(undefined, {
    manifestOverrides: {
      sourceCutAt: CUT,
      availability: {
        mutationAvailableThrough: CUT,
        exportAvailableAt: "2024-01-09T04:01:00.000Z",
        evidence: "finite-producer-availability-v1",
      },
    },
  });
  let now = new Date("2024-01-09T04:02:00.000Z");
  let app,
    ready = false,
    publicationMaxTimeMS;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(now), timeZone: "UTC" });
    const old = await builder.build(previous.sourceCut, FIXTURE_BUDGET, {
      ...previous.comparisonContext,
      comparisonOnly: false,
    });
    const active = await builder.publish(old, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-11T05:00:00.000Z" });
    const before = await page(app);
    fixture.client.on("commandStarted", ({ command }) => {
      if (
        command.update === "patients_model_control" &&
        command.updates[0].u.slots?.some((slot) => slot.state === "ready")
      ) {
        ready = true;
        now = new Date("2024-01-09T10:02:59.980Z");
      }
      if (ready && command.find === "patients_generations") {
        publicationMaxTimeMS = command.maxTimeMS;
        now = new Date("2024-01-09T10:03:00.001Z");
      }
    });
    await expect(
      builder.refresh(
        {
          cutAt: CUT,
          expectedActive: active,
          acquire: async () => {
            now = new Date("2024-01-09T04:03:00.000Z");
            return cut.sourceCut;
          },
        },
        FIXTURE_BUDGET,
        { ...cut.comparisonContext, comparisonOnly: false }
      )
    ).rejects.toThrow();
    expect(publicationMaxTimeMS).toBeLessThanOrEqual(20);
    expect(await page(app)).toEqual(before);
  } finally {
    await app?.close();
    cut.close();
    previous.close();
    await fixture.close();
  }
}, 60000);

it("keeps all six previous responses and their source time when a full refresh build exceeds six hours", async () => {
  const fixture = await openFixture();
  const transport = await openTransport();
  const client = new MongoClient(transport.uri);
  const previous = sealSnapshotFixture(undefined, { manifestOverrides: { sourceCutAt: "2024-01-08T04:00:00.000Z" } });
  const cut = sealSnapshotFixture(undefined, {
    manifestOverrides: {
      sourceCutAt: CUT,
      availability: {
        mutationAvailableThrough: CUT,
        exportAvailableAt: "2024-01-09T04:01:00.000Z",
        evidence: "finite-producer-availability-v1",
      },
    },
  });
  let now = new Date("2024-01-09T04:02:00.000Z");
  let app, pending;
  try {
    await client.connect();
    const builder = createBuilder({
      db: client.db(fixture.db.databaseName),
      clock: () => new Date(now),
      timeZone: "UTC",
    });
    const old = await builder.build(previous.sourceCut, FIXTURE_BUDGET, {
      ...previous.comparisonContext,
      comparisonOnly: false,
    });
    const active = await builder.publish(old, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: "2024-01-11T05:00:00.000Z" });
    const before = await page(app);
    const reached = transport.arm(
      (command) => typeof command.aggregate === "string" && command.aggregate.endsWith("_raw")
    );
    pending = builder.refresh(
      {
        cutAt: CUT,
        expectedActive: active,
        acquire: async () => {
          now = new Date("2024-01-09T04:03:00.000Z");
          return cut.sourceCut;
        },
      },
      FIXTURE_BUDGET,
      { ...cut.comparisonContext, comparisonOnly: false }
    );
    const outcome = pending.catch((error) => error);
    await reached;
    now = new Date("2024-01-09T10:03:00.001Z");
    transport.release();
    expect(await outcome).toBeInstanceOf(Error);
    expect(await page(app)).toEqual(before);
    expect(
      before.every(
        ({ status, sourceCutAt, state }) =>
          status === 200 && sourceCutAt === "2024-01-08T04:00:00.000Z" && state === "stale"
      )
    ).toBe(true);
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await app?.close();
    await client.close();
    await transport.close();
    cut.close();
    previous.close();
    await fixture.close();
  }
}, 60000);

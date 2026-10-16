import { expect, it } from "vite-plus/test";
import { openFixture } from "./contract.cjs";
import { rawDocuments, FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK } from "./snapshot-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { startApplication } from "./application.cjs";

async function post(app, route, body) {
  const response = await fetch(`${app.url}/ncds_api/api/v1/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function cutForSelection() {
  return sealSnapshotFixture(
    rawDocuments().map((row) => ({
      ...row,
      claim_date: new Date(row.claim_date.getTime() + 6 * 86400000),
      ...(row.hcode === "H2" && row.claim_date.getUTCDate() === 1 ? { area: "A" } : {}),
    }))
  );
}

async function replaceContribution(db, generationId, row, donor, categories) {
  const chunks = db.collection("patients_bitmap_chunks"),
    directory = db.collection("patients_bitmap_directory");
  const originals = [];
  for (const category of categories) {
    const filter = { generationId, setId: row.rowId, category };
    const original = await chunks.findOne(filter, { promoteLongs: false });
    const header = await directory.findOne(filter, { promoteLongs: false });
    const replacement = await chunks.findOne({ generationId, setId: donor.rowId, category }, { promoteLongs: false });
    expect(original.popcount).toBe(1);
    expect(replacement.popcount).toBe(1);
    expect(original.checksum).not.toBe(replacement.checksum);
    const changes = { checksum: replacement.checksum, length: replacement.length };
    originals.push({ original, header });
    await chunks.updateOne({ _id: original._id }, { $set: { ...changes, payload: replacement.payload } });
    await directory.updateOne({ _id: header._id }, { $set: changes });
  }
  return async () => {
    for (const { original, header } of originals) {
      await chunks.replaceOne({ _id: original._id }, original);
      await directory.replaceOne({ _id: header._id }, header);
    }
  };
}

it("rejects a same-cardinality daily contribution and matching directory replacement on all partial-range routes", async () => {
  const fixture = await openFixture(),
    cut = cutForSelection();
  let app, restore;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const generation = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(generation, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK });
    const selection = { startDate: "2024-01-07", endDate: "2024-01-07T23:59:59.999Z", area: "A", province: "P" };
    const routes = ["card", "bar-chart-pt", "bar-chart-ex"];
    const ordinary = await Promise.all(routes.map((route) => post(app, route, selection)));
    expect(ordinary.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(ordinary[0].body.result[0].patient_count).toBe(1);
    const daily = fixture.db.collection("patients_daily");
    const row = await daily.findOne({
      generationId: generation.generationId,
      hcode: "H2",
      date: new Date("2024-01-07"),
    });
    const donor = await daily.findOne({
      generationId: generation.generationId,
      hcode: "H2",
      date: new Date("2024-01-08"),
    });
    restore = await replaceContribution(fixture.db, generation.generationId, row, donor, ["DM", "CARD"]);
    for (const route of routes)
      expect(await post(app, route, selection)).toEqual({
        status: 503,
        body: { status: false, message: "Read model unavailable" },
      });
    await restore();
    restore = undefined;
    expect(await Promise.all(routes.map((route) => post(app, route, selection)))).toEqual(ordinary);
    const original = await daily.findOne({ _id: row._id }, { promoteLongs: false, promoteValues: false });
    await daily.updateOne({ _id: row._id }, { $set: { "members.COPD.directorySha256": "0".repeat(64) } });
    try {
      expect((await post(app, "card", selection)).status).toBe(503);
    } finally {
      await daily.replaceOne({ _id: row._id }, original);
    }
    expect(await post(app, "card", selection)).toEqual(ordinary[0]);
  } finally {
    await restore?.();
    await app?.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

it("rejects changed stored-atom directories for combined geography and restores all three ordinary graph responses", async () => {
  const fixture = await openFixture(),
    cut = cutForSelection();
  let app, restore;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const generation = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(generation, null);
    app = await startApplication({ db: fixture.db, activeGeneration: true, clock: SNAPSHOT_CLOCK });
    const selection = { area: "A", province: "P" },
      routes = ["graph-disease-pt", "graph-dm-pt", "graph-ca-pt"];
    const ordinary = await Promise.all(routes.map((route) => post(app, route, selection)));
    expect(ordinary.map((response) => response.status)).toEqual([200, 200, 200]);
    const atoms = fixture.db.collection("patients_month_atoms");
    const row = await atoms.findOne({ generationId: generation.generationId, hcode: "H2", area: "A" });
    const donor = await atoms.findOne({ generationId: generation.generationId, hcode: "H2", area: 2 });
    restore = await replaceContribution(fixture.db, generation.generationId, row, donor, ["DM"]);
    for (const route of routes)
      expect(await post(app, route, selection)).toEqual({
        status: 503,
        body: { status: false, message: "Read model unavailable" },
      });
    await restore();
    restore = undefined;
    expect(await Promise.all(routes.map((route) => post(app, route, selection)))).toEqual(ordinary);
    const original = await atoms.findOne({ _id: row._id }, { promoteLongs: false, promoteValues: false });
    await atoms.updateOne({ _id: row._id }, { $set: { "members.COPD.directorySha256": "0".repeat(64) } });
    try {
      expect((await post(app, routes[0], selection)).status).toBe(503);
    } finally {
      await atoms.replaceOne({ _id: row._id }, original);
    }
    expect(await post(app, routes[0], selection)).toEqual(ordinary[0]);
  } finally {
    await restore?.();
    await app?.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

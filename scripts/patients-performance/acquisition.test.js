import { expect, it } from "vite-plus/test";
import { MongoClient } from "mongodb";
import { openFixture } from "./contract.cjs";
import { FIXTURE_BUDGET } from "./raw-fixture.cjs";
import { sealSnapshotFixture, SNAPSHOT_CLOCK } from "./snapshot-fixture.cjs";
import { createBuilder } from "../../src/modules/patients/read-model/builder.js";
import { createReader } from "../../src/modules/patients/read-model/reader.js";
import { openTransport } from "./mongo-transport.cjs";
import { startApplication } from "./application.cjs";
import { SNAPSHOT_REQUEST } from "./snapshot-fixture.cjs";

async function until(check) {
  const end = Date.now() + 3000;
  while (!(await check())) {
    if (Date.now() >= end) throw new Error("Actual acquisition did not settle");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

it("bounds initial control and committed pin or capacity acquisition while retaining actual eventual ownership", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture();
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    const control = fixture.db.collection("patients_model_control");
    for (const mode of ["exists", "selection", "pin", "capacity", "cancel"]) {
      const transport = await openTransport(),
        client = new MongoClient(transport.uri);
      let read;
      try {
        await client.connect();
        const reached = transport.arm((command) => {
          if (["exists", "cancel"].includes(mode))
            return command.find === "patients_model_control" && !!command.projection;
          if (mode === "selection") return command.find === "patients_model_control" && !command.projection;
          const replacement = command.updates?.[0]?.u;
          return (
            command.update === "patients_model_control" &&
            (mode === "pin"
              ? replacement?.pins?.some((pin) => pin.kind === "reader")
              : replacement?.capacity?.owners?.length > 0)
          );
        });
        const cancellation = new AbortController();
        let called = false;
        read = createReader({ db: client.db(fixture.db.databaseName), validationOnly: true }).read(
          {
            route: "card/live",
            backendMode: "candidate-validation",
            clock: new Date(SNAPSHOT_CLOCK),
            timeZone: "UTC",
            timeoutMS: mode === "cancel" ? 1000 : 100,
            signal: cancellation.signal,
          },
          () => {
            called = true;
            return "unexpected";
          }
        );
        const outcome = read.then(
          () => "resolved",
          () => "rejected"
        );
        await reached;
        if (mode === "cancel") cancellation.abort();
        expect(
          await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve("pending"), 300))]),
          mode
        ).toBe("rejected");
        expect(called).toBe(false);
        if (["pin", "capacity"].includes(mode)) {
          const state = await control.findOne({ _id: "patients" });
          expect(state.pins.some((pin) => pin.generationId === candidate.generationId)).toBe(true);
          if (mode === "capacity") expect(state.capacity.owners.length).toBeGreaterThan(0);
        }
      } finally {
        transport.release();
        await read?.catch(() => {});
        await until(async () => {
          const state = await control.findOne({ _id: "patients" });
          return !state.pins.length && !state.capacity?.owners?.length;
        });
        await client.close();
        await transport.close();
      }
    }
    const result = await createReader({ db: fixture.db, validationOnly: true }).read(
      { route: "card/snapshot", backendMode: "candidate-validation", clock: new Date(SNAPSHOT_CLOCK), timeZone: "UTC" },
      ({ snapshot }) => snapshot("card")
    );
    expect(result.result[0].patient_count).toBe(6);
  } finally {
    cut.close();
    await fixture.close();
  }
}, 60000);

it("keeps the fixed HTTP deadline through a held post-Reader response-encoding admission", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture(),
    transport = await openTransport();
  let app, pending;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    app = await startApplication({
      db: fixture.db,
      activeGeneration: true,
      clock: SNAPSHOT_CLOCK,
      transportUri: transport.uri,
    });
    const reached = transport.arm((command) => {
      const next = command.updates?.[0]?.u;
      return (
        command.update === "patients_model_control" &&
        next?.capacity?.owners?.some(
          (owner) => owner.pin && owner.serializedWindowBytes > 0 && !next.pins.some((pin) => pin.id === owner.pin)
        )
      );
    });
    const started = performance.now();
    pending = fetch(`${app.url}/ncds_api/api/v1/card`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SNAPSHOT_REQUEST),
    });
    await Promise.race([
      reached,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Encoding boundary was not reached")), 10000)),
    ]);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: false, message: "Read model unavailable" });
    expect(performance.now() - started).toBeLessThan(62000);
    expect(
      (await fixture.db.collection("patients_model_control").findOne({ _id: "patients" })).capacity.owners.length
    ).toBeGreaterThan(0);
    transport.release();
    await until(
      async () =>
        !(await fixture.db.collection("patients_model_control").findOne({ _id: "patients" })).capacity.owners.length
    );
  } finally {
    transport.release();
    await pending?.catch(() => {});
    await app?.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 90000);

it("releases an admitted reader after cancellation before its capacity CAS is dispatched", async () => {
  const fixture = await openFixture(),
    cut = sealSnapshotFixture(),
    transport = await openTransport(),
    client = new MongoClient(transport.uri);
  const cancellation = new AbortController();
  let read;
  try {
    const builder = createBuilder({ db: fixture.db, clock: () => new Date(SNAPSHOT_CLOCK), timeZone: "UTC" });
    const candidate = await builder.build(cut.sourceCut, FIXTURE_BUDGET, {
      ...cut.comparisonContext,
      comparisonOnly: false,
    });
    await builder.publish(candidate, null);
    await client.connect();
    let projectedReads = 0;
    const reached = transport.arm((command) => {
      if (command.find !== "patients_model_control") return false;
      if (command.projection) {
        projectedReads += 1;
        return false;
      }
      return projectedReads === 2;
    });
    let called = false;
    read = createReader({ db: client.db(fixture.db.databaseName), validationOnly: true }).read(
      {
        route: "card/live",
        backendMode: "candidate-validation",
        clock: new Date(SNAPSHOT_CLOCK),
        timeZone: "UTC",
        signal: cancellation.signal,
      },
      () => {
        called = true;
        return "unexpected";
      }
    );
    void read.catch(() => {});
    await reached;
    cancellation.abort();
    await expect(read).rejects.toThrow(/deadline|cancellation/);
    expect(called).toBe(false);
    const control = fixture.db.collection("patients_model_control");
    expect((await control.findOne({ _id: "patients" })).pins.some((pin) => pin.kind === "reader")).toBe(true);
    transport.release();
    await until(async () => {
      const state = await control.findOne({ _id: "patients" });
      return !state.pins.length && !state.capacity?.owners?.length;
    });
  } finally {
    transport.release();
    await read?.catch(() => {});
    await client.close();
    await transport.close();
    cut.close();
    await fixture.close();
  }
}, 60000);

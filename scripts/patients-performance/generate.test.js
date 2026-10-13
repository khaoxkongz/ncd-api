/* eslint-disable prettier/prettier */
import { describe, expect, it } from "vite-plus/test";
import { BSON } from "mongodb";
import generator from "./generate.cjs";

const { ARRAY_FIELDS, CA_SUBTYPES, DM_SUBTYPES, HOSPITALS, MAIN_ARRAYS, generateWorkload } = generator;
const workload = generateWorkload();

function fixtureDocuments(id) {
  const ids = new Set(workload.fixtures.find((fixture) => fixture.id === id).documentIds);
  return workload.documents.filter((document) => ids.has(document._id.toHexString()));
}

function matches(document, body) {
  return (
    document.date >= new Date(body.startDate) &&
    document.date <= new Date(body.endDate) &&
    ["area", "province", "district", "hcode"].every((field) => !body[field] || document[field] === body[field])
  );
}

describe("accepted synthetic Patients workload", () => {
  it("regenerates identical BSON and uses one shared first profile", () => {
    const repeat = generateWorkload({ pool: "scaled" });
    expect(repeat.manifest.dataDigest).toEqual(workload.manifest.dataDigest);
    expect(
      repeat.documents.every((document, index) =>
        BSON.serialize(document).equals(BSON.serialize(workload.documents[index]))
      )
    ).toBe(true);
    expect(workload.documents).toHaveLength(1000);
    expect(workload.documents.filter((document) => document._perf_kind === "fixed")).toHaveLength(100);
    expect(workload.documents.filter((document) => document._perf_kind === "seeded")).toHaveLength(900);
    expect(workload.documents.every((document) => document._perf_profile === workload.manifest.profileId)).toBe(true);
  });

  it("observes exactly 2,000 synthetic CIDs and proves all four reuse dimensions for 500 members", () => {
    const observed = new Map();
    for (const document of workload.documents) {
      for (const field of MAIN_ARRAYS) {
        for (const cid of document[field]) {
          expect(cid).toMatch(/^[a-f0-9]{64}$/);
          if (!observed.has(cid))
            observed.set(cid, { days: new Set(), months: new Set(), hospitals: new Set(), diseases: new Set() });
          const entry = observed.get(cid);
          entry.days.add(document.date.toISOString().slice(0, 10));
          entry.months.add(`${document.year}-${document.month}`);
          entry.hospitals.add(document.hcode);
          entry.diseases.add(field);
        }
      }
    }
    expect(observed.size).toBe(2000);
    const membersWithAllDimensions = [...observed.values()].filter((entry) =>
      Object.values(entry).every((values) => values.size >= 2)
    );
    expect(membersWithAllDimensions.length).toBeGreaterThanOrEqual(500);
    expect(workload.manifest.reuseCohort).toEqual({
      size: 500,
      minimumDistinctPerDimension: 2,
      verifiedMembersByDimension: { days: 500, months: 500, hospitals: 500, diseases: 500 },
    });
    const report = JSON.stringify(workload.manifest);
    expect([...observed.keys()].some((cid) => report.includes(cid))).toBe(false);
  });

  it("keeps exact main-array frequencies, unique memberships and parent subsets", () => {
    for (const field of MAIN_ARRAYS)
      expect(workload.manifest.seededMainArrayHistograms[field]).toEqual({
        0: 72,
        1: 72,
        5: 72,
        10: 540,
        25: 72,
        50: 72,
      });
    for (const document of workload.documents) {
      for (const field of ARRAY_FIELDS) {
        expect(new Set(document[field]).size).toBe(document[field].length);
        expect(document[field].length).toBeLessThanOrEqual(50);
      }
      for (const [fields, parent] of [
        [DM_SUBTYPES, "dm_cid_count"],
        [CA_SUBTYPES, "ca_cid_count"],
      ]) {
        for (const field of fields) expect(document[field].every((cid) => document[parent].includes(cid))).toBe(true);
      }
      if (document._perf_kind === "seeded") {
        expect(MAIN_ARRAYS.some((field) => document[field].length > 0)).toBe(true);
        for (const field of MAIN_ARRAYS) {
          const prefix = field.replace("_cid_count", "");
          expect(document[`${prefix}_uid_count`]).toBeGreaterThanOrEqual(document[field].length);
          expect(Number.isFinite(document[`${prefix}_expense`])).toBe(true);
        }
      }
    }
    for (const histogram of Object.values(workload.manifest.requestedSubtypeLengthHistograms)) {
      expect(Object.values(histogram).reduce((total, count) => total + count, 0)).toBe(900);
      expect(Object.values(histogram).every((count) => count > 0)).toBe(true);
    }
  });

  it("preserves hospital/day uniqueness, date coverage, skew and the full hierarchy", () => {
    const days = workload.documents.map((document) => `${document.hcode}:${document.date.toISOString().slice(0, 10)}`);
    expect(new Set(days).size).toBe(1000);
    const months = Object.keys(workload.manifest.dates.countsByMonth);
    expect(months).toHaveLength(32);
    expect(months).not.toContain("2026-02");
    expect(months).not.toContain("2026-05");
    expect(workload.documents.some((document) => document.date.toISOString().startsWith("2024-02-29"))).toBe(true);
    expect(HOSPITALS).toHaveLength(24);
    expect(new Set(HOSPITALS.map((hospital) => hospital.area)).size).toBe(3);
    expect(new Set(HOSPITALS.map((hospital) => hospital.province)).size).toBe(6);
    expect(new Set(HOSPITALS.map((hospital) => hospital.district)).size).toBe(12);
    const quotas = workload.manifest.geography.hospitals.map((hospital) => hospital.seededDocuments);
    expect(quotas.filter((count) => count === 450)).toHaveLength(1);
    expect(quotas.filter((count) => count === 20)).toHaveLength(13);
    expect(quotas.filter((count) => count === 19)).toHaveLength(10);
    for (const document of workload.documents) {
      expect(document.year).toBe(document.date.getUTCFullYear());
      expect(document.month).toBe(document.date.getUTCMonth() + 1);
      expect(document.fiscal_year).toBe(document.year + (document.month >= 10 ? 1 : 0));
      if (document._perf_kind === "seeded") expect(document.date.toISOString().endsWith("T00:00:00.000Z")).toBe(true);
    }
  });

  it("reserves hand-checkable fixed cases, including errors and inclusive timestamp bounds", () => {
    const partial = workload.fixtures.find((fixture) => fixture.id === "inclusive-partial-day-bounds");
    expect(fixtureDocuments(partial.id)).toHaveLength(6);
    expect(workload.documents.filter((document) => matches(document, partial.body))).toHaveLength(4);
    const arithmetic = workload.fixtures.find((fixture) => fixture.id === "arithmetic-overlap");
    const arithmeticMatches = workload.documents.filter((document) => matches(document, arithmetic.body));
    expect(
      arithmeticMatches.map((document) => document._id.toHexString()).sort((left, right) => left.localeCompare(right))
    ).toEqual([...arithmetic.documentIds].sort((left, right) => left.localeCompare(right)));
    expect(new Set(arithmeticMatches.flatMap((document) => MAIN_ARRAYS.flatMap((field) => document[field]))).size).toBe(
      4
    );
    expect(new Set(arithmeticMatches.map((document) => document.hcode)).size).toBe(2);
    expect(
      arithmeticMatches.reduce(
        (total, document) =>
          total + MAIN_ARRAYS.reduce((count, field) => count + document[field.replace("_cid_count", "_uid_count")], 0),
        0
      )
    ).toBe(26);
    const overlap = fixtureDocuments("disease-sum-versus-union")[0];
    expect(new Set(MAIN_ARRAYS.flatMap((field) => overlap[field])).size).toBe(1);
    expect(MAIN_ARRAYS.reduce((total, field) => total + overlap[field].length, 0)).toBe(6);
    for (const [id, dmOther, caOther] of [
      ["dm-ca-other-positive", 1, 1],
      ["dm-ca-other-zero", 0, 0],
      ["dm-ca-other-negative", -2, -3],
    ]) {
      const document = fixtureDocuments(id)[0];
      expect(
        document.dm_cid_count.length - DM_SUBTYPES.reduce((total, field) => total + document[field].length, 0)
      ).toBe(dmOther);
      expect(
        document.ca_cid_count.length - CA_SUBTYPES.reduce((total, field) => total + document[field].length, 0)
      ).toBe(caOther);
    }
    const empty = fixtureDocuments("empty-patients-positive-scalars")[0];
    expect(MAIN_ARRAYS.every((field) => empty[field].length === 0)).toBe(true);
    expect(empty.dm_uid_count).toBeGreaterThan(0);
    expect(empty.dm_expense).toBeGreaterThan(0);
  });

  it("measures actual BSON including ownership metadata and deterministic ids", () => {
    const sizes = workload.documents.map((document) => BSON.serialize(document).length);
    expect(sizes.reduce((total, size) => total + size, 0)).toBe(workload.manifest.summaryBsonBytes);
    expect(Math.max(...sizes)).toBe(workload.manifest.maxSummaryBsonBytes);
    expect(workload.manifest.maxSummaryBsonBytes).toBeLessThanOrEqual(128 * 1024);
    expect(workload.manifest.summaryBsonBytes).toBeLessThan(100 * 1024 * 1024);
    expect(workload.manifest.bson.indexesAndSnapshotsIncluded).toBe(false);
  });

  it("rejects unsupported profile inputs before generation", () => {
    expect(() => generateWorkload({ documentCount: 1001 })).toThrow("Supported document counts");
    expect(() => generateWorkload({ pool: "unexpected" })).toThrow("Pool must be");
    expect(() => generateWorkload({ seed: -1 })).toThrow("unsigned 32-bit");
  });

  it("supports both growth pools with exact frequencies and the same fixed memberships", () => {
    for (const documentCount of [2000, 5000, 10000]) {
      for (const pool of ["fixed", "scaled"]) {
        const grown = generateWorkload({ documentCount, pool });
        const expectedCids = pool === "fixed" ? 2000 : documentCount * 2;
        expect(grown.documents).toHaveLength(documentCount);
        expect(grown.manifest.counts.distinctObservedCids).toBe(expectedCids);
        expect(grown.manifest.reuseCohort.size).toBe(expectedCids / 4);
        expect(grown.manifest.geography.busyGroup.seededDocuments).toBe((documentCount - 100) / 2);
        expect(
          grown.manifest.geography.busyGroup.hcodes.every(
            (hcode) => HOSPITALS.find((hospital) => hospital.hcode === hcode).area === "SYN-A01"
          )
        ).toBe(true);
        for (const field of MAIN_ARRAYS) {
          expect(grown.manifest.seededMainArrayHistograms[field]).toEqual({
            0: (documentCount - 100) * 0.08,
            1: (documentCount - 100) * 0.08,
            5: (documentCount - 100) * 0.08,
            10: (documentCount - 100) * 0.6,
            25: (documentCount - 100) * 0.08,
            50: (documentCount - 100) * 0.08,
          });
        }
        expect(
          grown.documents.slice(0, 100).every((document, index) => {
            const { _perf_profile: grownProfile, ...grownFixed } = document;
            const { _perf_profile: firstProfile, ...firstFixed } = workload.documents[index];
            return grownProfile !== firstProfile && BSON.serialize(grownFixed).equals(BSON.serialize(firstFixed));
          })
        ).toBe(true);
        expect(grown.manifest.summaryBsonBytes).toBeLessThan(100 * 1024 * 1024);
        expect(grown.manifest.maxSummaryBsonBytes).toBeLessThan(128 * 1024);
      }
    }
  });
});

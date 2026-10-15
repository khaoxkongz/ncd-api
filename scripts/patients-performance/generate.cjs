const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { BSON, ObjectId } = require("mongodb");

const PROFILE_VERSION = "patients-synthetic-v1";
const CALCULATION_CLOCK = "2026-10-13T05:00:00.000Z";
const MAIN_ARRAYS = ["dm", "ht", "copd", "ca", "psy", "hd_cvd"].map((name) => `${name}_cid_count`);
const DM_SUBTYPES = ["hg", "dm_ckd", "dm_acs", "dm_cva"].map((name) => `${name}_cid_count`);
const CA_SUBTYPES = ["lung_ca", "breast_ca", "cervical_ca", "liver_ca", "colorectal_ca"].map(
  (name) => `${name}_cid_count`
);
const SUBTYPE_ARRAYS = [...DM_SUBTYPES, ...CA_SUBTYPES];
const ARRAY_FIELDS = [...MAIN_ARRAYS, ...SUBTYPE_ARRAYS];
const HOSPITALS = Array.from({ length: 24 }, (_, index) => ({
  hcode: `SYN-H${String(index + 1).padStart(2, "0")}`,
  hname: `Synthetic Hospital ${String(index + 1).padStart(2, "0")}`,
  area: `SYN-A${String(Math.floor(index / 8) + 1).padStart(2, "0")}`,
  province: `SYN-P${String(Math.floor(index / 4) + 1).padStart(2, "0")}`,
  district: `SYN-D${String(Math.floor(index / 2) + 1).padStart(2, "0")}`,
}));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// Mulberry32 uses only unsigned 32-bit integer arithmetic. The seed and algorithm
// are manifest fields so the workload can be regenerated without external state.
function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function daysInWindow() {
  const days = [];
  for (
    let time = Date.parse("2024-01-01T00:00:00.000Z");
    time <= Date.parse("2026-10-13T00:00:00.000Z");
    time += 86400000
  ) {
    const day = new Date(time).toISOString().slice(0, 10);
    if (!day.startsWith("2026-02") && !day.startsWith("2026-05")) days.push(day);
  }
  return days;
}

function makeDocument(hospital, instant, identity, arrays = {}, scalars = {}) {
  const date = new Date(instant);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const result = {
    _id: new ObjectId(sha256(identity).slice(0, 24)),
    ...hospital,
    date,
    year,
    month,
    fiscal_year: year + (month >= 10 ? 1 : 0),
    created_at: new Date(CALCULATION_CLOCK),
    updated_at: new Date(CALCULATION_CLOCK),
  };
  for (const field of ARRAY_FIELDS) {
    result[field] = [...(arrays[field] || [])];
    const disease = field.slice(0, -"_cid_count".length);
    result[`${disease}_expense`] = result[field].length * 1.125;
    if (MAIN_ARRAYS.includes(field)) result[`${disease}_uid_count`] = result[field].length;
  }
  return Object.assign(result, scalars);
}

function fixedRecords(cids, seed) {
  const documents = [];
  const labels = new Map();
  const reservations = new Map();
  const occupiedDays = new Set();
  function reserve(hospitalIndex, month) {
    const hcode = HOSPITALS[hospitalIndex].hcode;
    if (!reservations.has(hcode)) reservations.set(hcode, new Set());
    reservations.get(hcode).add(month);
  }
  function add(label, hospitalIndex, instant, arrays = {}, scalars = {}) {
    const hospital = HOSPITALS[hospitalIndex];
    const day = instant.slice(0, 10);
    const dayKey = `${hospital.hcode}:${day}`;
    if (occupiedDays.has(dayKey)) throw new Error(`Duplicate fixed hospital/day: ${dayKey}`);
    occupiedDays.add(dayKey);
    const document = makeDocument(
      hospital,
      instant,
      `${PROFILE_VERSION}:${seed}:fixed:${documents.length}`,
      arrays,
      scalars
    );
    documents.push(document);
    if (!labels.has(label)) labels.set(label, []);
    labels.get(label).push(document._id.toHexString());
    return document;
  }
  const pick = (...indexes) => indexes.map((index) => cids[index]);
  // These whole hospital/month scopes stay free of seeded and filler records.
  for (const hospitalIndex of [20, 21, 22, 23]) {
    for (const month of ["2024-02", "2024-03", "2026-09", "2026-10"]) reserve(hospitalIndex, month);
  }
  for (const hospitalIndex of [17, 18]) {
    for (const month of ["2024-01", "2025-12", "2026-09", "2026-10"]) reserve(hospitalIndex, month);
  }
  for (const month of ["2024-02", "2026-10"]) reserve(19, month);
  for (const month of ["2024-11", "2025-11", "2026-10"]) reserve(16, month);

  for (const [label, hospitalIndex, mainLength] of [
    ["dm-ca-other-positive", 20, 5],
    ["dm-ca-other-zero", 21, 4],
    ["dm-ca-other-negative", 22, 2],
  ]) {
    const caLength = label === "dm-ca-other-positive" ? 6 : label === "dm-ca-other-zero" ? 5 : 2;
    const arrays = {
      dm_cid_count: cids.slice(0, mainLength),
      ca_cid_count: cids.slice(0, caLength),
    };
    DM_SUBTYPES.forEach((field, index) => {
      arrays[field] = pick(label === "dm-ca-other-negative" ? 0 : index);
    });
    CA_SUBTYPES.forEach((field, index) => {
      arrays[field] = pick(label === "dm-ca-other-negative" ? 0 : index);
    });
    add(label, hospitalIndex, "2026-09-15T00:00:00.000Z", arrays);
  }
  add(
    "disease-sum-versus-union",
    23,
    "2026-09-15T00:00:00.000Z",
    Object.fromEntries(MAIN_ARRAYS.map((field) => [field, pick(0)]))
  );
  add(
    "arithmetic-overlap",
    23,
    "2026-10-01T00:00:00.000Z",
    {
      dm_cid_count: pick(0, 1),
      ht_cid_count: pick(1, 2),
      hg_cid_count: pick(0),
      dm_ckd_cid_count: pick(0),
    },
    { dm_uid_count: 5, ht_uid_count: 7, dm_expense: 1.005, ht_expense: 2.675 }
  );
  add(
    "arithmetic-overlap",
    23,
    "2026-10-02T00:00:00.000Z",
    {
      dm_cid_count: pick(0),
      ht_cid_count: pick(2),
      ca_cid_count: pick(0, 3),
      lung_ca_cid_count: pick(0),
      breast_ca_cid_count: pick(0),
    },
    { dm_uid_count: 3, ht_uid_count: 2, ca_uid_count: 4, dm_expense: 0.004, ht_expense: 1.335, ca_expense: 3.333 }
  );
  add(
    "arithmetic-overlap",
    22,
    "2026-10-03T00:00:00.000Z",
    {
      dm_cid_count: pick(0),
      ca_cid_count: pick(0),
      hg_cid_count: pick(0),
      lung_ca_cid_count: pick(0),
    },
    { dm_uid_count: 2, ca_uid_count: 3, dm_expense: 9.999, ca_expense: 0.006 }
  );
  add("empty-patients-positive-scalars", 21, "2026-10-05T00:00:00.000Z", {}, { dm_uid_count: 4, dm_expense: 1.005 });
  const boundaryInstants = [
    [20, "2024-02-29T05:59:59.999Z"],
    [21, "2024-02-29T06:00:00.000Z"],
    [22, "2024-02-29T06:00:00.001Z"],
    [23, "2024-03-01T17:59:59.999Z"],
    [20, "2024-03-01T18:00:00.000Z"],
    [21, "2024-03-01T18:00:00.001Z"],
  ];
  for (const [hospitalIndex, instant] of boundaryInstants)
    add("inclusive-partial-day-bounds", hospitalIndex, instant, { dm_cid_count: pick(6) });
  add("leap-day", 19, "2024-02-29T00:00:00.000Z", { dm_cid_count: pick(7) });
  for (const [hospitalIndex, instant] of [
    [17, "2024-01-01T00:00:00.000Z"],
    [18, "2024-01-01T00:00:00.001Z"],
    [17, "2026-10-13T00:00:00.000Z"],
    [18, "2026-10-13T00:00:00.001Z"],
  ])
    add("range-bounds", hospitalIndex, instant, { ht_cid_count: pick(8) });
  for (const [hospitalIndex, instant] of [
    [17, "2026-09-30T16:59:59.999Z"],
    [18, "2026-09-30T17:00:00.000Z"],
    [17, "2025-12-31T16:59:59.999Z"],
    [18, "2025-12-31T17:00:00.000Z"],
    [19, "2026-10-12T23:59:59.999Z"],
    [20, "2026-10-13T00:00:00.000Z"],
  ])
    add("clock-boundaries", hospitalIndex, instant, { copd_cid_count: pick(9) });
  for (const instant of ["2024-11-01T00:00:00.000Z", "2025-11-01T00:00:00.000Z", "2026-10-13T00:00:00.000Z"]) {
    add("graph-position-anchors", 16, instant, { psy_cid_count: pick(10) });
  }
  // Filler fixed records deliberately cover every permitted month. They use
  // small, hand-checkable memberships and never enter a named reserved scope.
  const days = daysInWindow();
  const months = [...new Set(days.map((day) => day.slice(0, 7)))];
  let fillerIndex = 0;
  while (documents.length < 100) {
    const month = months[fillerIndex % months.length];
    const hospitalIndex = fillerIndex % 16;
    const hospital = HOSPITALS[hospitalIndex];
    const candidates = days.filter((day) => day.startsWith(month) && !occupiedDays.has(`${hospital.hcode}:${day}`));
    const day = candidates[Math.floor(fillerIndex / months.length) % candidates.length];
    add("fixed-coverage", hospitalIndex, `${day}T00:00:00.000Z`, {
      dm_cid_count: pick(11 + (fillerIndex % 39)),
      ht_cid_count: pick(0),
    });
    fillerIndex += 1;
  }
  const body = (startDate, endDate, scope) => ({
    startDate,
    endDate,
    area: "",
    province: "",
    district: "",
    hcode: "",
    ...scope,
  });
  const fixtureDefinitions = [
    [
      "arithmetic-overlap",
      "Repeated CIDs, visits and hospitals with disease expense rounding boundaries",
      body("2026-10-01", "2026-10-03", { province: "SYN-P06" }),
      { patientUnion: 4, hospitalCount: 2, serviceCount: 26 },
    ],
    [
      "disease-sum-versus-union",
      "One CID in all six diseases: Card union 1 and Disease monthly Total 6",
      body("2026-09-15", "2026-09-15", { hcode: "SYN-H24" }),
      { patientUnion: 1, diseaseCountSum: 6 },
    ],
    [
      "dm-ca-other-positive",
      "DM and CA have positive Other after subtype subtraction",
      body("2026-09-15", "2026-09-15", { hcode: "SYN-H21" }),
      { dmOther: 1, caOther: 1 },
    ],
    [
      "dm-ca-other-zero",
      "DM and CA subtype counts equal their main counts",
      body("2026-09-15", "2026-09-15", { hcode: "SYN-H22" }),
      { dmOther: 0, caOther: 0 },
    ],
    [
      "dm-ca-other-negative",
      "Overlapping subtypes produce negative subtraction, clamped to zero",
      body("2026-09-15", "2026-09-15", { hcode: "SYN-H23" }),
      { dmBeforeClamp: -2, caBeforeClamp: -3 },
    ],
    [
      "empty-patients-positive-scalars",
      "Positive service and expense scalars with all patient arrays empty",
      body("2026-10-05", "2026-10-05", { hcode: "SYN-H22" }),
      { patientUnion: 0 },
    ],
    [
      "inclusive-partial-day-bounds",
      "Records immediately before, at and after both inclusive timestamp bounds",
      body("2024-02-29T06:00:00.000Z", "2024-03-01T18:00:00.000Z", { province: "SYN-P06" }),
      { matchingDocuments: 4 },
    ],
    [
      "leap-day",
      "Leap day isolated from seeded records",
      body("2024-02-29", "2024-02-29", { hcode: "SYN-H20" }),
      { matchingDocuments: 1 },
    ],
    [
      "range-bounds",
      "Oldest and current-day date bounds with millisecond records around the end",
      body("2024-01-01", "2026-10-13", { province: "SYN-P05" }),
      {},
    ],
    [
      "clock-boundaries",
      "UTC metadata around local month, local year and UTC midnight boundaries",
      body("2024-01-01", "2026-10-13", { province: "SYN-P05" }),
      {},
    ],
    [
      "graph-position-anchors",
      "Prior-year, oldest included and current graph month anchors",
      body("2024-01-01", "2026-10-13", { hcode: "SYN-H17" }),
      {},
    ],
  ];
  const fixtures = fixtureDefinitions.map(([id, description, requestBody, handCheck]) => ({
    id,
    description,
    body: requestBody,
    clock: CALCULATION_CLOCK,
    timezone: "Asia/Bangkok",
    documentIds: labels.get(id),
    handCheck,
    ...(id === "empty-patients-positive-scalars" ? { expectedError: ["card"] } : {}),
  }));
  return { documents, fixtures, reservations, occupiedDays };
}

function histogram(documents, field) {
  const counts = {};
  for (const document of documents) counts[document[field].length] = (counts[document[field].length] || 0) + 1;
  return counts;
}

function generateWorkload({ documentCount = 1000, pool = "fixed", seed = 20261013, generatorRevision = null } = {}) {
  if (![1000, 2000, 5000, 10000].includes(documentCount))
    throw new Error("Supported document counts: 1000, 2000, 5000, 10000");
  if (!["fixed", "scaled"].includes(pool)) throw new Error("Pool must be fixed or scaled");
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("Seed must be an unsigned 32-bit integer");
  const distinctCount = pool === "scaled" ? documentCount * 2 : 2000;
  const cohortCount = distinctCount / 4;
  const effectivePool = documentCount === 1000 ? "shared" : pool;
  const profileId = `${PROFILE_VERSION}-${documentCount}-${effectivePool}-seed-${seed}`;
  const cids = Array.from({ length: distinctCount }, (_, index) =>
    sha256(`${PROFILE_VERSION}:synthetic-patient:${seed}:${index}`)
  );
  const random = randomSource(seed);
  const fixed = fixedRecords(cids, seed);
  const seededCount = documentCount - 100;
  const busyTotal = seededCount / 2;
  const days = daysInWindow();
  const available = HOSPITALS.map((hospital) =>
    days.filter(
      (day) =>
        !fixed.occupiedDays.has(`${hospital.hcode}:${day}`) &&
        !fixed.reservations.get(hospital.hcode)?.has(day.slice(0, 7))
    )
  );
  const busyGroupSize =
    documentCount === 1000
      ? 1
      : Math.ceil(busyTotal / Math.min(...available.slice(0, 8).map((values) => values.length)));
  if (busyGroupSize > 8) throw new Error("Busy group exceeds the available hospitals in one health area");
  const quotas = HOSPITALS.map(() => 0);
  for (let index = 0; index < busyGroupSize; index += 1)
    quotas[index] = Math.floor(busyTotal / busyGroupSize) + (index < busyTotal % busyGroupSize ? 1 : 0);
  const otherHospitals = shuffle(
    Array.from({ length: 24 - busyGroupSize }, (_, index) => index + busyGroupSize),
    random
  );
  otherHospitals.forEach((hospitalIndex, rank) => {
    quotas[hospitalIndex] =
      Math.floor(busyTotal / otherHospitals.length) + (rank < busyTotal % otherHospitals.length ? 1 : 0);
  });
  const seeded = [];
  HOSPITALS.forEach((hospital, hospitalIndex) => {
    if (quotas[hospitalIndex] > available[hospitalIndex].length)
      throw new Error(`Insufficient unique dates for ${hospital.hcode}`);
    const selectedDays = shuffle(available[hospitalIndex], random).slice(0, quotas[hospitalIndex]);
    for (const day of selectedDays)
      seeded.push(
        makeDocument(
          hospital,
          `${day}T00:00:00.000Z`,
          `${PROFILE_VERSION}:${seed}:${documentCount}:${effectivePool}:seeded:${hospital.hcode}:${day}`
        )
      );
  });
  const orderedSeeded = shuffle(seeded, random);
  const fractionCount = seededCount * 0.08;
  const lengths = shuffle(
    [0, 1, 5, 25, 50].flatMap((length) => Array(fractionCount).fill(length)).concat(Array(seededCount * 0.6).fill(10)),
    random
  );
  // Shift the same zero positions until no document is empty in all diseases.
  // Exact per-array frequencies survive any shift; rotations add no CIDs.
  const shiftedLengths = MAIN_ARRAYS.map((_, diseaseIndex) =>
    lengths.map((__, index) => lengths[(index + diseaseIndex * fractionCount) % seededCount])
  );
  for (let index = 0; index < seededCount; index += 1) {
    if (shiftedLengths.every((values) => values[index] === 0)) {
      const replacement = shiftedLengths[0].findIndex(
        (length, other) => length > 0 && shiftedLengths.slice(1).some((values) => values[other] > 0)
      );
      [shiftedLengths[0][index], shiftedLengths[0][replacement]] = [
        shiftedLengths[0][replacement],
        shiftedLengths[0][index],
      ];
    }
  }
  for (let index = 0; index < seededCount; index += 1)
    MAIN_ARRAYS.forEach((field, diseaseIndex) => {
      orderedSeeded[index][field] = Array(shiftedLengths[diseaseIndex][index]).fill(null);
    });
  // Guarantee every cohort member occurs in different years, hospitals, days
  // and main diseases. Filling random memberships alone would not prove reuse.
  const busyCodes = new Set(HOSPITALS.slice(0, busyGroupSize).map((hospital) => hospital.hcode));
  for (const { field, inBusyGroup, yearPredicate } of [
    { field: "dm_cid_count", inBusyGroup: true, yearPredicate: (year) => year === 2024 },
    { field: "ht_cid_count", inBusyGroup: false, yearPredicate: (year) => year >= 2025 },
  ]) {
    let cidIndex = 0;
    for (const document of orderedSeeded) {
      if (busyCodes.has(document.hcode) !== inBusyGroup || !yearPredicate(document.year)) continue;
      for (let index = 0; index < document[field].length && cidIndex < cohortCount; index += 1)
        document[field][index] = cids[cidIndex++];
      if (cidIndex === cohortCount) break;
    }
    if (cidIndex !== cohortCount) throw new Error(`Insufficient reserved reuse memberships for ${field}`);
  }
  let poolCursor = 0;
  const requestedSubtypeLengthHistograms = Object.fromEntries(
    SUBTYPE_ARRAYS.map((field) => [field, { 0: 0, 1: 0, 5: 0, 10: 0 }])
  );
  for (const document of orderedSeeded) {
    for (const field of MAIN_ARRAYS) {
      const seen = new Set(document[field].filter(Boolean));
      for (let index = 0; index < document[field].length; index += 1) {
        if (document[field][index] !== null) continue;
        let cid;
        do {
          cid = cids[poolCursor++ % distinctCount];
        } while (seen.has(cid));
        document[field][index] = cid;
        seen.add(cid);
      }
      const disease = field.slice(0, -"_cid_count".length);
      document[`${disease}_uid_count`] =
        document[field].length === 0 ? 0 : document[field].length + Math.floor(random() * (document[field].length + 1));
      document[`${disease}_expense`] = (Math.floor(random() * 100000) / 1000) * document[field].length;
    }
    for (const [fields, parent] of [
      [DM_SUBTYPES, "dm_cid_count"],
      [CA_SUBTYPES, "ca_cid_count"],
    ]) {
      for (const field of fields) {
        const requestedLength = [0, 1, 5, 10][Math.floor(random() * 4)];
        requestedSubtypeLengthHistograms[field][requestedLength] += 1;
        document[field] = shuffle(document[parent], random).slice(
          0,
          Math.min(requestedLength, document[parent].length)
        );
        document[`${field.slice(0, -"_cid_count".length)}_expense`] =
          (Math.floor(random() * 100000) / 1000) * document[field].length;
      }
    }
  }
  const documents = [...fixed.documents, ...orderedSeeded];
  documents.forEach((document, index) => {
    document._perf_profile = profileId;
    document._perf_kind = index < 100 ? "fixed" : "seeded";
  });
  const observed = new Set();
  const cohort = new Map(
    cids
      .slice(0, cohortCount)
      .map((cid) => [cid, { days: new Set(), months: new Set(), hospitals: new Set(), diseases: new Set() }])
  );
  const hospitalDays = new Set();
  const months = {};
  let memberships = 0;
  let bsonBytes = 0;
  let maxDocumentBytes = 0;
  const dataHash = createHash("sha256");
  for (const document of documents) {
    const day = document.date.toISOString().slice(0, 10);
    const dayKey = `${document.hcode}:${day}`;
    if (hospitalDays.has(dayKey)) throw new Error(`Duplicate hospital/day: ${dayKey}`);
    hospitalDays.add(dayKey);
    months[day.slice(0, 7)] = (months[day.slice(0, 7)] || 0) + 1;
    for (const field of ARRAY_FIELDS) {
      if (document[field].length > 50 || new Set(document[field]).size !== document[field].length)
        throw new Error(`Invalid CID array: ${field}`);
      memberships += document[field].length;
      for (const cid of document[field]) {
        observed.add(cid);
        const reuse = cohort.get(cid);
        if (reuse && MAIN_ARRAYS.includes(field)) {
          reuse.days.add(day);
          reuse.months.add(day.slice(0, 7));
          reuse.hospitals.add(document.hcode);
          reuse.diseases.add(field);
        }
      }
    }
    const serialized = BSON.serialize(document);
    bsonBytes += serialized.length;
    maxDocumentBytes = Math.max(maxDocumentBytes, serialized.length);
    dataHash.update(serialized);
  }
  if (observed.size !== distinctCount) throw new Error(`Observed ${observed.size} CIDs; expected ${distinctCount}`);
  const reuseDimensions = Object.fromEntries(
    ["days", "months", "hospitals", "diseases"].map((dimension) => [
      dimension,
      [...cohort.values()].filter((reuse) => reuse[dimension].size >= 2).length,
    ])
  );
  if (Object.values(reuseDimensions).some((count) => count !== cohortCount))
    throw new Error("Reuse cohort failed a required dimension");
  if (maxDocumentBytes > 128 * 1024 || bsonBytes > 100 * 1024 * 1024)
    throw new Error("Profile exceeds its uncompressed document budget");
  const expectedMonths = [...new Set(days.map((day) => day.slice(0, 7)))];
  if (expectedMonths.some((month) => !months[month]) || months["2026-02"] || months["2026-05"])
    throw new Error("Date coverage violates the accepted profile");
  const manifest = {
    profileId,
    summaryBsonBytes: bsonBytes,
    maxSummaryBsonBytes: maxDocumentBytes,
    profile: {
      version: PROFILE_VERSION,
      id: profileId,
      documentCount,
      pool: effectivePool,
      seed,
      randomAlgorithm: "mulberry32",
      generatorRevision,
      generatorCodeSha256: sha256(readFileSync(__filename)),
    },
    collections: {
      NCD_SUMMARY: documentCount,
      NCD_Summary_Temp_Table: { maximumDocuments: 1, state: "not-generated; baseline captures supply snapshots" },
    },
    counts: { fixedDocuments: 100, seededDocuments: seededCount, distinctObservedCids: observed.size, memberships },
    reuseCohort: { size: cohortCount, minimumDistinctPerDimension: 2, verifiedMembersByDimension: reuseDimensions },
    seededMainArrayHistograms: Object.fromEntries(MAIN_ARRAYS.map((field) => [field, histogram(orderedSeeded, field)])),
    requestedSubtypeLengthHistograms,
    allArrayHistograms: Object.fromEntries(ARRAY_FIELDS.map((field) => [field, histogram(documents, field)])),
    arrayMemberships: Object.fromEntries(
      ARRAY_FIELDS.map((field) => [field, documents.reduce((total, document) => total + document[field].length, 0)])
    ),
    dates: {
      start: "2024-01-01",
      end: "2026-10-13",
      excludedMonths: ["2026-02", "2026-05"],
      countsByMonth: Object.fromEntries(Object.entries(months).sort(([left], [right]) => left.localeCompare(right))),
      uniqueHospitalDays: hospitalDays.size,
      uniqueDateHospitalPairs: hospitalDays.size,
      metadataTimezone: "UTC",
    },
    geography: {
      areaCount: 3,
      provinceCount: 6,
      districtCount: 12,
      hospitalCount: 24,
      busyGroup: { hcodes: [...busyCodes], area: HOSPITALS[0].area, seededDocuments: busyTotal, fraction: 0.5 },
      hospitals: HOSPITALS.map((hospital, index) => ({
        ...hospital,
        seededDocuments: quotas[index],
        fixedDocuments: fixed.documents.filter((document) => document.hcode === hospital.hcode).length,
        totalDocuments: documents.filter((document) => document.hcode === hospital.hcode).length,
      })),
    },
    reservedScopes: [...fixed.reservations].map(([hcode, reservedMonths]) => ({
      hcode,
      months: [...reservedMonths].sort((left, right) => left.localeCompare(right)),
    })),
    bson: {
      summaryDocumentBytes: bsonBytes,
      maximumSummaryDocumentBytes: maxDocumentBytes,
      summaryDocumentLimitBytes: 128 * 1024,
      databaseLimitBytes: 100 * 1024 * 1024,
      indexesAndSnapshotsIncluded: false,
    },
    dataDigest: { algorithm: "sha256", encoding: "ordered BSON document bytes", value: dataHash.digest("hex") },
    calculation: { clock: CALCULATION_CLOCK, timezone: "Asia/Bangkok" },
    fixedCases: fixed.fixtures,
  };
  return { documents, manifest, fixtures: fixed.fixtures };
}

module.exports = {
  PROFILE_VERSION,
  CALCULATION_CLOCK,
  MAIN_ARRAYS,
  DM_SUBTYPES,
  CA_SUBTYPES,
  SUBTYPE_ARRAYS,
  ARRAY_FIELDS,
  HOSPITALS,
  generateWorkload,
};

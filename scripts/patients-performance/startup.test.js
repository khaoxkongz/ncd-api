import { expect, it } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openFixture } from "./contract.cjs";

it("starts the existing Express app and serves all six legacy routes with an unavailable native codec and no source configuration", async () => {
  const connection = await openFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "patients-startup-"));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const program = `
    const Module = require("node:module");
    const originalLoad = Module._load;
    Module._load = function (request, ...rest) {
      if (request === "roaring" || request.startsWith("roaring/")) throw new Error("Native codec unavailable");
      return originalLoad.call(this, request, ...rest);
    };
    const app = require(${JSON.stringify(path.join(root, "src/app.js"))});
    const server = app.listen(0, "127.0.0.1", async () => {
      try {
        const statuses = [];
        for (const route of ["card", "bar-chart-pt", "bar-chart-ex", "graph-disease-pt", "graph-dm-pt", "graph-ca-pt"]) {
          const response = await fetch("http://127.0.0.1:" + server.address().port + "/ncds_api/api/v1/" + route, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate: "2024-01-01", endDate: "2026-10-13" }),
          });
          const body = await response.json();
          statuses.push([response.status, body.status, body.message]);
        }
        process.stdout.write("FIXTURE_RESULT=" + JSON.stringify(statuses) + "\\n");
      } catch (error) {
        process.exitCode = 1;
        process.stderr.write(error.name + "\\n");
      } finally {
        server.close();
        await require(${JSON.stringify(path.join(root, "src/lib/mongo.js"))}).db.client.close();
      }
    });
  `;
  const uri = new URL(process.env.PATIENTS_TEST_MONGO_URI);
  uri.pathname = `/${connection.db.databaseName}`;
  try {
    const output = execFileSync(process.execPath, ["-e", program], {
      cwd: directory,
      timeout: 20000,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        NCD_PATIENTS_BACKEND: "legacy",
        MONGO_URI: uri.toString(),
        DISCORD_BOT_TOKEN: "unused-fixture",
        DISCORD_CHANNEL_ID_SUCCESS: "unused-fixture",
        DISCORD_CHANNEL_ID_PROGRESS: "unused-fixture",
        DISCORD_CHANNEL_ID_ERROR: "unused-fixture",
        CID_HASH_SECRET_KEY: "unused-fixture",
      },
    });
    const result = output.split("\n").find((line) => line.startsWith("FIXTURE_RESULT="));
    expect(JSON.parse(result.slice("FIXTURE_RESULT=".length))).toEqual(
      Array.from({ length: 6 }, () => [200, true, "success"])
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    await connection.close();
  }
}, 30000);

const { createHmac } = require("node:crypto");

// The baseline identity finalization. Builders apply this exactly once after
// raw hospital-day ETL; dictionary equivalence never calls this function.
function finalizeCid(cid, secret) {
  if (!cid) return null;
  return createHmac("sha256", secret).update(cid.toString()).digest("hex");
}

module.exports = { finalizeCid };

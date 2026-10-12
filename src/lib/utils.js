const crypto = require("crypto");
const { env } = require("../env");

function formatDateAsString(date) {
  return date.toISOString().split("T")[0];
}

function hashCid(cid) {
  if (!cid) return null;
  return crypto.createHmac("sha256", env.CID_HASH_SECRET_KEY).update(cid.toString()).digest("hex");
}

module.exports = {
  formatDateAsString,
  hashCid,
};

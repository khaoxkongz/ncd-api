const { finalizeCid } = require("./hash-cid");
const { env } = require("../env");

function formatDateAsString(date) {
  return date.toISOString().split("T")[0];
}

function hashCid(cid) {
  return finalizeCid(cid, env.CID_HASH_SECRET_KEY);
}

module.exports = {
  formatDateAsString,
  hashCid,
};

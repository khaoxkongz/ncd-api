const { MongoClient } = require("mongodb");

const { env } = require("../env");

const client = new MongoClient(env.MONGO_URI);
const db = client.db();

module.exports = {
  db,
};

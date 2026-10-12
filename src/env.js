const { createEnv } = require("@t3-oss/env-core");
const { config } = require("dotenv");
const { expand } = require("dotenv-expand");
const { z } = require("zod");

expand(config());

const env = createEnv({
  server: {
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().default(8080),
    MONGO_HOST: z.string().optional(),
    MONGO_USERNAME: z.string().optional(),
    MONGO_PASSWORD: z.string().optional(),
    MONGO_PORT: z.coerce.number().default(27017).optional(),
    MONGO_DBNAME: z.string().optional(),
    MONGO_URI: z.string().url(),
    DISCORD_BOT_TOKEN: z.string(),
    DISCORD_CHANNEL_ID_SUCCESS: z.string(),
    DISCORD_CHANNEL_ID_PROGRESS: z.string(),
    DISCORD_CHANNEL_ID_ERROR: z.string(),
    CID_HASH_SECRET_KEY: z.string(),
  },
  onValidationError: (error) => {
    console.error("❌ Invalid environment variables:", error.flatten().fieldErrors);
    process.exit(1);
  },
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
});

module.exports = {
  env,
};

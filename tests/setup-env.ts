import { existsSync } from "node:fs";

// Load private local config, then point every test at the isolated Neon *test* branch.
if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.DATABASE_URL_TEST) throw new Error("DATABASE_URL_TEST is required for tests (never the demo database)");
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.UNDO_ALLOW_RESET = "1";
process.env.NODE_NO_WARNINGS = "1";

// copies the scouting app's golden team stats fixture over the board's copy in tests/fixtures
// usage: node scripts/team-stats-fixture.mjs [path/to/team_stats.json]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = process.argv[2] ?? fileURLToPath(new URL("../../Scouting-2026/test/team_stats/golden/team_stats.json", import.meta.url));
const target = fileURLToPath(new URL("../tests/fixtures/scouting-team-stats.json", import.meta.url));
const json = readFileSync(source, "utf8");

const teams = JSON.parse(json).team_stats;
if (!Array.isArray(teams) || !teams.length) throw new Error(`No Team Stats found in ${source}`);

writeFileSync(target, json);
console.log(`Copied the Team Stats of ${teams.length} teams to ${target}`);

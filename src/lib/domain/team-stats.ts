import type { JsonValue, MatchPacket, TeamStats, TeamStatsAnswer, TeamStatsFetch } from "$lib/native/types";

import { readExtras } from "./extras";
import { isObject } from "./json";
import { packetLineup } from "./reassign";
import { ALLIANCE_STATIONS, ALLIANCES, OUR_TEAM, STATION_NAMES, teamNumberKey, type AllianceColor, type StationKey } from "./stations";
import { matchEventKey } from "./sync";
import { resolveTeamColor, type TeamColorOverrides } from "./team-colors";
import { textDirection, type TextDirection } from "./text-direction";

export const TEAM_STATS_FORMAT_VERSION = 1;

const MINUTE_MS = 60_000;
// a Synced Strategy device stamps Confirmed every minute - this long without one is more than a match behind
const STALE_MINUTES = 10;
const UNREACHABLE = "Can't reach the database";

export interface StatsViewInput {
  // null until the first fetch answers
  lastFetch: TeamStatsFetch | null;
  packet: MatchPacket;
  chosenStage: string | null;
  teamColors: TeamColorOverrides;
  autoLighten: boolean;
  // Date.now() - the age of the numbers is read against the tablet's clock
  now: number;
}

// a Bench Team is in no Station - so its column sits at its alliance's bench
export type StatsPlace = StationKey | "redBench" | "blueBench";

export interface StatsColumn {
  place: StatsPlace;
  placeName: string;
  alliance: AllianceColor;
  team: string;
  color: string;
  ourTeam: boolean;
  noData: boolean;
  activeFaults: number;
  robotTags: StatsTag[];
  // a Bench Team - drawn dimmed and its numbers never count for its alliance
  bench: boolean;
}

// one alliance's columns - its Stations then its Bench Team
export interface StatsAlliance {
  alliance: AllianceColor;
  columnIndexes: number[];
  // the Alliance Total spans the Station columns alone
  stationSpan: number;
  // its Bench Team has a column - left empty on the Alliance Total
  bench: boolean;
}

export interface StatsTag {
  name: string;
  color: string;
  dir: TextDirection;
}

export interface StatsFault {
  match: string;
  status: string;
  message: string;
  messageDir: TextDirection;
  resolution: string | null;
  resolutionDir: TextDirection;
  // "2/3 scouters" - only for a fault off a double-scouted match
  scouters: string | null;
}

export interface StatsTeamFaults {
  column: StatsColumn;
  faults: StatsFault[];
}

// the marks the coach draws for a yes or no answer
export type StatsMark = "green check" | "red cross" | "grey cross";

export interface StatsCell {
  text: string;
  // a yes or no is drawn as its mark - text holds its words
  mark?: StatsMark;
  // drawn brighter as the best on its alliance - absent on every other cell
  best?: boolean;
}

export interface StatsRow {
  label: string;
  explanation: string | null;
  // one per column - null where the team has no Team Stats
  cells: Array<StatsCell | null>;
}

export interface StatsGridCell {
  text: string;
  // reads nought - drawn faint so the cells with something in them stand out
  zero: boolean;
}

interface TeamGrid {
  rows: string[];
  columns: string[];
  // one list per row label - each as long as columns
  cells: StatsGridCell[][];
}

export interface StatsGridLine {
  label: string;
  // one per column - null where the team has no grid to draw
  cells: Array<StatsGridCell[] | null>;
}

// drawn as rows of the Stage's table so each team's grid sits in its own column
export interface StatsGrid {
  label: string;
  explanation: string | null;
  columns: string[];
  // one per row label
  lines: StatsGridLine[];
}

export interface StatsNoteCategory {
  label: string;
  stars: number | null;
  // more than one rating went into the stars
  average: boolean;
  latest: string;
  dir: TextDirection;
  // "+N more notes" - null when the latest is the only one
  more: string | null;
}

export interface StatsNotes {
  // "N scouters" - null when one scouter or none wrote
  scouters: string | null;
  defenseStarred: boolean;
  categories: StatsNoteCategory[];
}

export interface StatsCard {
  // headed like the team's column in the tables
  column: StatsColumn;
  // null when the team has no Team Stats
  notes: StatsNotes | null;
}

export interface StatsCardRow {
  alliance: AllianceColor;
  cards: StatsCard[];
}

export interface StatsStage {
  label: string;
  chosen: boolean;
  // null on a Stage the Scouting App doesn't total
  totals: Record<AllianceColor, string> | null;
  rows: StatsRow[];
  // drawn below the Stage's table
  grids: StatsGrid[];
  // a Stage of notes draws a card per team instead of a table
  cardRows: StatsCardRow[];
  // listed below the table - only Pit has any
  faults: StatsTeamFaults[];
}

export interface StatsNotice {
  title: string;
  detail: string;
}

export interface StatsFreshness {
  // how long ago the numbers were Confirmed
  confirmed: string;
  // Confirmed long ago or never - drawn so old numbers look old
  stale: boolean;
  // set when the last fetch failed and the numbers are the ones the tablet kept
  unreachable: StatsNotice | null;
}

export type StatsView =
  | { kind: "loading" }
  | ({ kind: "notice" } & StatsNotice)
  | { kind: "stats"; columns: StatsColumn[]; alliances: StatsAlliance[]; estimatedScores: Record<AllianceColor, string>; stages: StatsStage[]; eventBanner: StatsNotice | null; freshness: StatsFreshness };

interface PublishedRow {
  label: string;
  explanation: string | null;
  // null when neither way is better
  direction: "higher" | "lower" | null;
  value: JsonValue;
}

interface PublishedStage {
  label: string;
  // undefined on a Stage the Scouting App doesn't total - null when the team has nothing to add
  total: number | null | undefined;
  rows: PublishedRow[];
}

function publishedDirection(direction: unknown): "higher" | "lower" | null {
  return direction === "higher" || direction === "lower" ? direction : null;
}

function publishedRows(rows: JsonValue | undefined): PublishedRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => isObject(row) && typeof row.label === "string"
    ? [{ label: row.label, explanation: typeof row.explanation === "string" ? row.explanation : null, direction: publishedDirection(row.direction), value: row.value ?? null }]
    : []);
}

function publishedTotal(total: unknown): number | null | undefined {
  if (total === undefined) return undefined;
  return typeof total === "number" ? total : null;
}

function publishedStages(payload: JsonValue | undefined): PublishedStage[] {
  if (!isObject(payload) || !Array.isArray(payload.stages)) return [];
  return payload.stages.flatMap((stage) => isObject(stage) && typeof stage.label === "string" ? [{ label: stage.label, total: publishedTotal(stage.total), rows: publishedRows(stage.rows) }] : []);
}

// Team Stats published before faults and tags have no such key - the same as none
function publishedList(payload: JsonValue | undefined, key: string): unknown[] {
  const list = isObject(payload) ? payload[key] : undefined;
  return Array.isArray(list) ? list : [];
}

function publishedTags(payload: JsonValue | undefined): StatsTag[] {
  return publishedList(payload, "robot_tags").flatMap((tag) => isObject(tag) && typeof tag.name === "string" && typeof tag.color === "string" ? [{ name: tag.name, color: tag.color, dir: textDirection(tag.name) }] : []);
}

function publishedFaults(payload: JsonValue | undefined): StatsFault[] {
  return publishedList(payload, "active_faults").flatMap((fault) => {
    if (!isObject(fault) || typeof fault.message !== "string") return [];
    const resolution = typeof fault.resolution === "string" ? fault.resolution : null;
    return [{
      match: typeof fault.match === "string" ? fault.match : "",
      status: typeof fault.status === "string" ? fault.status : "",
      message: fault.message,
      messageDir: textDirection(fault.message),
      resolution,
      resolutionDir: textDirection(resolution ?? ""),
      scouters: typeof fault.reported_by === "number" && typeof fault.scouters === "number" ? `${fault.reported_by}/${fault.scouters} scouters` : null,
    }];
  });
}

function tooNew(payload: JsonValue | undefined): boolean {
  return isObject(payload) && typeof payload.version === "number" && payload.version > TEAM_STATS_FORMAT_VERSION;
}

function yesNoCell(answer: unknown): StatsCell | null {
  switch (answer) {
    case "yes": return { text: "Yes", mark: "green check" };
    case "no": return { text: "No", mark: "red cross" };
    case "unknown": return { text: "Unknown", mark: "grey cross" };
    default: return null;
  }
}

// the one reading of a text value that both the cell and the best go by
function isDrawnText(value: unknown): value is { kind: "text"; text: string; raw?: unknown } {
  return isObject(value) && value.kind === "text" && typeof value.text === "string";
}

// a new kind of value doesn't bump the format version - so one this board can't draw shows as a dash
function cell(value: JsonValue): StatsCell {
  if (isDrawnText(value)) return { text: value.text };
  if (isObject(value) && value.kind === "yes_no") return yesNoCell(value.answer) ?? { text: "-" };
  return { text: "-" };
}

function unique(labels: string[]): string[] {
  return [...new Set(labels)];
}

function rowsLabelled(teamStages: Array<PublishedStage | undefined>, label: string) {
  const rows = teamStages.map((stage) => stage?.rows.find((row) => row.label === label));
  return { rows, explanation: rows.find((row) => row?.explanation)?.explanation ?? null };
}

const NOUGHT = /^0+(\/0+)*$/;

function isTexts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// a grid whose cells don't line up with its labels has nothing sure to draw
function teamGrid(value: JsonValue): TeamGrid | null {
  if (!isObject(value) || value.kind !== "grid") return null;
  const { rows, columns, cells } = value;
  if (!isTexts(rows) || !isTexts(columns) || !Array.isArray(cells)) return null;
  const lines = cells.filter((line): line is string[] => isTexts(line) && line.length === columns.length);
  if (lines.length !== cells.length || cells.length !== rows.length) return null;
  return { rows, columns, cells: lines.map((line) => line.map((text) => ({ text, zero: NOUGHT.test(text) }))) };
}

function sameLabels(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((label, index) => label === right[index]);
}

// a row is a grid when any team sends it as one - so it never also shows in the table as dashes
// every team's cells sit under the first team's labels - so a grid labelled otherwise has nothing sure to draw
function stageGrids(teamStages: Array<PublishedStage | undefined>, columns: StatsColumn[]): StatsGrid[] {
  const labels = unique(teamStages.flatMap((stage) => stage?.rows.filter((row) => isObject(row.value) && row.value.kind === "grid").map((row) => row.label) ?? []));
  return labels.map((label) => {
    const { rows, explanation } = rowsLabelled(teamStages, label);
    const grids = rows.map((row, index) => (row && !columns[index].noData ? teamGrid(row.value) : null));
    const shape = grids.find((grid) => grid !== null);
    if (!shape) return { label, explanation, columns: [], lines: [] };
    const fitting = grids.map((grid) => (grid && sameLabels(grid.rows, shape.rows) && sameLabels(grid.columns, shape.columns) ? grid : null));
    return { label, explanation, columns: shape.columns, lines: shape.rows.map((rowLabel, line) => ({ label: rowLabel, cells: fitting.map((grid) => grid?.cells[line] ?? null) })) };
  });
}

function notesIn(payload: JsonValue | undefined, label: string): Record<string, unknown> | null {
  if (!isObject(payload) || !Array.isArray(payload.stages)) return null;
  const stage = payload.stages.find((candidate) => isObject(candidate) && candidate.label === label);
  return isObject(stage) && isObject(stage.notes) ? stage.notes : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function moreNotes(older: number): string | null {
  return older > 0 ? `+${plural(older, "more note")}` : null;
}

function noteCategories(categories: unknown): StatsNoteCategory[] {
  if (!Array.isArray(categories)) return [];
  return categories.flatMap((category) => {
    if (!isObject(category) || typeof category.label !== "string") return [];
    const latest = typeof category.latest === "string" ? category.latest : "";
    return [{
      label: category.label,
      stars: typeof category.stars === "number" ? category.stars : null,
      average: count(category.ratings) > 1,
      latest,
      dir: textDirection(latest),
      more: moreNotes(count(category.older)),
    }];
  });
}

function stageNotes(notes: Record<string, unknown> | null): StatsNotes {
  const scouters = count(notes?.scouters);
  return {
    scouters: scouters > 1 ? `${scouters} scouters` : null,
    defenseStarred: notes?.defense_starred === true,
    categories: noteCategories(notes?.categories),
  };
}

const BENCHES = { red: { place: "redBench", placeName: "Red Bench" }, blue: { place: "blueBench", placeName: "Blue Bench" } } as const;

// the Match's teams in column order - each alliance's Stations then its Bench Team
function columnTeams(packet: MatchPacket) {
  const lineup = packetLineup(packet);
  const bench = readExtras(packet).bench ?? {};
  return ALLIANCES.flatMap((alliance) => [
    ...ALLIANCE_STATIONS[alliance].map((station) => ({ place: station, placeName: STATION_NAMES[station], alliance, team: lineup[station].trim(), bench: false })),
    { ...BENCHES[alliance], alliance, team: bench[alliance]?.trim() ?? "", bench: true },
  ].filter(({ team }) => team));
}

// grouped by alliance rather than cut at Blue 1 - a team added after its alliance still ends up with it
function alliancesOf(columns: StatsColumn[]): StatsAlliance[] {
  return ALLIANCES.flatMap((alliance) => {
    const columnIndexes = columns.flatMap((column, index) => column.alliance === alliance ? [index] : []);
    const stationSpan = stationIndexes(columns, alliance).length;
    return columnIndexes.length ? [{ alliance, columnIndexes, stationSpan, bench: columnIndexes.length > stationSpan }] : [];
  });
}

function cardRows(alliances: StatsAlliance[], cards: StatsCard[]): StatsCardRow[] {
  return alliances.map(({ alliance, columnIndexes }) => ({ alliance, cards: columnIndexes.map((index) => cards[index]) }));
}

function estimatedPoints(payload: JsonValue | undefined): number | null {
  return isObject(payload) && typeof payload.estimated_points === "number" ? payload.estimated_points : null;
}

// the teams whose numbers count for their alliance - every sum and every best
function stationIndexes(columns: StatsColumn[], alliance: AllianceColor): number[] {
  return columns.flatMap((column, index) => column.alliance === alliance && !column.bench ? [index] : []);
}

// a value drawn as a dash - a kind this board can't draw or a text with none to show - can't be the best
function rawNumber(value: JsonValue | undefined): number | null {
  return isDrawnText(value) && typeof value.raw === "number" ? value.raw : null;
}

function bestOnEachAlliance(columns: StatsColumn[], rows: Array<PublishedRow | undefined>): Set<number> {
  const direction = rows.find((row) => row)?.direction;
  if (!direction) return new Set();
  const pick = direction === "higher" ? Math.max : Math.min;
  return new Set(ALLIANCES.flatMap((alliance) => {
    const numbers = stationIndexes(columns, alliance).flatMap((index) => {
      const raw = rawNumber(rows[index]?.value);
      return raw === null ? [] : [{ index, raw }];
    });
    // a lone number would look like a win it isn't
    if (numbers.length < 2) return [];
    const best = pick(...numbers.map(({ raw }) => raw));
    const leaders = numbers.filter(({ raw }) => raw === best);
    // a tie that every team with a number shares picks out nobody either
    return leaders.length < numbers.length ? leaders.map(({ index }) => index) : [];
  }));
}

function allianceSums(columns: StatsColumn[], values: Array<number | null>): Record<AllianceColor, string> {
  const sum = (alliance: AllianceColor) => {
    const numbers = stationIndexes(columns, alliance).flatMap((index) => values[index] ?? []);
    return numbers.length ? numbers.reduce((total, value) => total + value).toFixed(0) : "-";
  };
  return { red: sum("red"), blue: sum("blue") };
}

// the last event's rows can linger after the scouting app moves on - so go by the numbers on screen
// and by every row when the match's teams have none - the banner then explains their no data columns
function eventBanner(packet: MatchPacket, shown: TeamStats[], answer: TeamStatsAnswer): StatsNotice | null {
  const eventKey = matchEventKey(packet);
  const events = unique((shown.length ? shown : answer.team_stats).map((row) => row.event).filter(Boolean));
  if (eventKey === null || events.every((event) => event === eventKey)) return null;
  return { title: `Team Stats from ${events.join(" and ")}`, detail: `This Match is from ${eventKey}.` };
}

// a server clock ahead of the tablet's would read as a time to come
function confirmedAgo(answer: TeamStatsAnswer, now: number): Pick<StatsFreshness, "confirmed" | "stale"> {
  const at = Date.parse(answer.team_stats_confirmed[0]?.confirmed_at ?? "");
  if (!Number.isFinite(at)) return { confirmed: "Not Confirmed yet", stale: true };
  const minutes = Math.floor(Math.max(0, now - at) / MINUTE_MS);
  const stale = minutes >= STALE_MINUTES;
  if (minutes < 1) return { confirmed: "Confirmed less than a minute ago", stale };
  return { confirmed: `Confirmed ${minutes < 60 ? plural(minutes, "minute") : plural(Math.floor(minutes / 60), "hour")} ago`, stale };
}

export function statsView({ lastFetch, packet, chosenStage, teamColors, autoLighten, now }: StatsViewInput): StatsView {
  if (!lastFetch) return { kind: "loading" };
  if (lastFetch.kind === "not-set-up") {
    return { kind: "notice", title: "Team Stats aren't set up in this build", detail: "Add HASURA_HTTP_LINK and HASURA_BOARD_TOKEN to orbit-strategy-board.env and rebuild." };
  }
  // what the tablet kept stays on screen while the database can't be reached
  const answer = (lastFetch.kind === "ok" ? lastFetch : lastFetch.cached)?.answer;
  if (!answer?.team_stats.length) {
    return lastFetch.kind === "unreachable"
      ? { kind: "notice", title: UNREACHABLE, detail: lastFetch.detail }
      : { kind: "notice", title: "No Team Stats have been published yet", detail: "They show up here once a Synced Scouting App device at Strategy role or above publishes them." };
  }
  if (answer.team_stats.some(({ payload }) => tooNew(payload))) {
    return { kind: "notice", title: "This board needs an update", detail: "The Scouting App publishes Team Stats in a newer format than this board can read." };
  }
  const published = new Map(answer.team_stats.map((row) => [String(row.team_number), row]));
  const teams = columnTeams(packet).map((column) => {
    const row = published.get(teamNumberKey(column.team) ?? "");
    return { ...column, row, payload: row?.payload };
  });
  const faultsByTeam = teams.map(({ payload }) => publishedFaults(payload));
  const columns = teams.map(({ place, placeName, alliance, team, bench, payload }, index) => ({
    place, placeName, alliance,
    team, color: resolveTeamColor(team, teamColors, autoLighten), ourTeam: teamNumberKey(team) === OUR_TEAM, noData: !isObject(payload),
    activeFaults: faultsByTeam[index].length, robotTags: publishedTags(payload), bench,
  }));
  const alliances = alliancesOf(columns);
  const faults = columns.flatMap((column, index) => faultsByTeam[index].length ? [{ column, faults: faultsByTeam[index] }] : []);
  const stagesByTeam = teams.map(({ payload }) => publishedStages(payload));
  const labels = unique(stagesByTeam.flatMap((stages) => stages.map((stage) => stage.label)));
  const chosen = chosenStage !== null && labels.includes(chosenStage) ? chosenStage : labels[0];
  const stages = labels.map((label) => {
    const teamStages = stagesByTeam.map((stages) => stages.find((stage) => stage.label === label));
    const grids = stageGrids(teamStages, columns);
    const rowLabels = unique(teamStages.flatMap((stage) => stage?.rows.map((row) => row.label) ?? [])).filter((rowLabel) => !grids.some((grid) => grid.label === rowLabel));
    const rows = rowLabels.map((rowLabel) => {
      const { rows: teamRows, explanation } = rowsLabelled(teamStages, rowLabel);
      const best = bestOnEachAlliance(columns, teamRows);
      return {
        label: rowLabel,
        explanation,
        cells: teamRows.map((row, index) => columns[index].noData ? null : { ...(row ? cell(row.value) : { text: "-" }), ...(best.has(index) ? { best: true } : {}) }),
      };
    });
    const totals = teamStages.some((stage) => stage?.total !== undefined) ? allianceSums(columns, teamStages.map((stage) => stage?.total ?? null)) : null;
    const notes = teams.map(({ payload }) => notesIn(payload, label));
    const cards = columns.map((column, index) => ({ column, notes: column.noData ? null : stageNotes(notes[index]) }));
    // the first Stage is Pit - the board never goes by a Stage's label
    return { label, chosen: label === chosen, totals, rows, grids, cardRows: notes.some(Boolean) ? cardRows(alliances, cards) : [], faults: label === labels[0] ? faults : [] };
  });
  return {
    kind: "stats", columns, alliances, estimatedScores: allianceSums(columns, teams.map(({ payload }) => estimatedPoints(payload))), stages,
    eventBanner: eventBanner(packet, teams.flatMap(({ row }) => row ?? []), answer),
    freshness: { ...confirmedAgo(answer, now), unreachable: lastFetch.kind === "unreachable" ? { title: UNREACHABLE, detail: lastFetch.detail } : null },
  };
}

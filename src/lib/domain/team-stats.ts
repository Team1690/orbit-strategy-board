import type { JsonValue, MatchPacket, TeamStatsAnswer, TeamStatsFetch } from "$lib/native/types";

import { isObject } from "./json";
import { packetLineup } from "./reassign";
import { OUR_TEAM, STATION_NAMES, STATIONS, stationAlliance, teamNumberKey, type AllianceColor, type StationKey } from "./stations";
import { matchEventKey } from "./sync";
import { resolveTeamColor, type TeamColorOverrides } from "./team-colors";
import { textDirection, type TextDirection } from "./text-direction";

export const TEAM_STATS_FORMAT_VERSION = 1;

export interface StatsViewInput {
  // null until the first fetch answers
  lastFetch: TeamStatsFetch | null;
  packet: MatchPacket;
  chosenStage: string | null;
  teamColors: TeamColorOverrides;
  autoLighten: boolean;
}

export interface StatsColumn {
  station: StationKey;
  stationName: string;
  alliance: AllianceColor;
  team: string;
  color: string;
  ourTeam: boolean;
  noData: boolean;
}

export interface StatsCell {
  text: string;
  // drawn brighter as the best on its alliance - absent on every other cell
  best?: boolean;
}

export interface StatsRow {
  label: string;
  explanation: string | null;
  // one per column - null where the team has no Team Stats
  cells: Array<StatsCell | null>;
}

export interface StatsNoteCategory {
  label: string;
  stars: number | null;
  // more than one rating went into the stars
  average: boolean;
  latest: string;
  direction: TextDirection;
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
  // a Stage of notes draws a card per team instead of a table
  cardRows: StatsCardRow[];
}

export type StatsView =
  | { kind: "loading" }
  | { kind: "notice"; title: string; detail: string | null }
  | { kind: "stats"; columns: StatsColumn[]; estimatedScores: Record<AllianceColor, string>; stages: StatsStage[]; eventBanner: { title: string; detail: string } | null };

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

function tooNew(payload: JsonValue | undefined): boolean {
  return isObject(payload) && typeof payload.version === "number" && payload.version > TEAM_STATS_FORMAT_VERSION;
}

// a new kind of value doesn't bump the format version - so one this board can't draw shows as a dash
function cellText(value: JsonValue): string {
  return isObject(value) && value.kind === "text" && typeof value.text === "string" ? value.text : "-";
}

function unique(labels: string[]): string[] {
  return [...new Set(labels)];
}

function notesIn(payload: JsonValue | undefined, label: string): Record<string, unknown> | null {
  if (!isObject(payload) || !Array.isArray(payload.stages)) return null;
  const stage = payload.stages.find((candidate) => isObject(candidate) && candidate.label === label);
  return isObject(stage) && isObject(stage.notes) ? stage.notes : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function moreNotes(older: number): string | null {
  return older > 0 ? `+${older} more ${older === 1 ? "note" : "notes"}` : null;
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
      direction: textDirection(latest),
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

// grouped by alliance rather than cut at Blue 1 - a team added after its alliance still ends up in its row
function cardRows(cards: StatsCard[]): StatsCardRow[] {
  return (["red", "blue"] as const).flatMap((alliance) => {
    const row = cards.filter((card) => card.column.alliance === alliance);
    return row.length ? [{ alliance, cards: row }] : [];
  });
}

function estimatedPoints(payload: JsonValue | undefined): number | null {
  return isObject(payload) && typeof payload.estimated_points === "number" ? payload.estimated_points : null;
}

// the teams whose numbers count for their alliance - every sum and every best
function stationColumns(columns: StatsColumn[], alliance: AllianceColor): number[] {
  return columns.flatMap((column, index) => column.alliance === alliance ? [index] : []);
}

// a kind this board can't draw shows a dash - so its number can't be the best
function rawNumber(value: JsonValue | undefined): number | null {
  return isObject(value) && value.kind === "text" && typeof value.raw === "number" ? value.raw : null;
}

function bestOnEachAlliance(columns: StatsColumn[], rows: Array<PublishedRow | undefined>): Set<number> {
  const direction = rows.find((row) => row)?.direction;
  if (!direction) return new Set();
  const pick = direction === "higher" ? Math.max : Math.min;
  return new Set((["red", "blue"] as const).flatMap((alliance) => {
    const numbers = stationColumns(columns, alliance).flatMap((index) => {
      const raw = rawNumber(rows[index]?.value);
      return raw === null ? [] : [{ index, raw }];
    });
    // a lone number would look like a win it isn't
    if (numbers.length < 2) return [];
    const best = pick(...numbers.map(({ raw }) => raw));
    return numbers.filter(({ raw }) => raw === best).map(({ index }) => index);
  }));
}

function allianceSums(columns: StatsColumn[], values: Array<number | null>): Record<AllianceColor, string> {
  const sum = (alliance: AllianceColor) => {
    const numbers = stationColumns(columns, alliance).flatMap((index) => values[index] ?? []);
    return numbers.length ? numbers.reduce((total, value) => total + value).toFixed(0) : "-";
  };
  return { red: sum("red"), blue: sum("blue") };
}

// the last event's rows can linger after the scouting app moves on - so go by the numbers on screen
// and by every row when the match's teams have none - the banner then explains their no data columns
function eventBanner(packet: MatchPacket, teams: string[], answer: TeamStatsAnswer) {
  const eventKey = matchEventKey(packet);
  const rows = new Map(answer.team_stats.map((row) => [String(row.team_number), row]));
  const shown = teams.flatMap((team) => rows.get(teamNumberKey(team) ?? "") ?? []);
  const events = unique((shown.length ? shown : answer.team_stats).map((row) => row.event).filter(Boolean));
  if (eventKey === null || events.every((event) => event === eventKey)) return null;
  return { title: `Team Stats from ${events.join(" and ")}`, detail: `This Match is from ${eventKey}.` };
}

export function statsView({ lastFetch, packet, chosenStage, teamColors, autoLighten }: StatsViewInput): StatsView {
  if (!lastFetch) return { kind: "loading" };
  if (lastFetch.kind === "not-set-up") {
    return { kind: "notice", title: "Team Stats aren't set up in this build", detail: "Add HASURA_HTTP_LINK and HASURA_BOARD_TOKEN to orbit-strategy-board.env and rebuild." };
  }
  if (lastFetch.kind === "unreachable") return { kind: "notice", title: "Can't reach the database", detail: lastFetch.detail };
  const lineup = packetLineup(packet);
  const published = new Map(lastFetch.answer.team_stats.map((team) => [String(team.team_number), team.payload]));
  const teams = STATIONS.flatMap((station) => {
    const team = lineup[station].trim();
    return team ? [{ station, team, payload: published.get(teamNumberKey(team) ?? "") }] : [];
  });
  if (teams.some(({ payload }) => tooNew(payload))) {
    return { kind: "notice", title: "This board needs an update", detail: "The Scouting App publishes Team Stats in a newer format than this board can read." };
  }
  const columns = teams.map(({ station, team, payload }) => ({
    station, stationName: STATION_NAMES[station], alliance: stationAlliance(station),
    team, color: resolveTeamColor(team, teamColors, autoLighten), ourTeam: teamNumberKey(team) === OUR_TEAM, noData: !isObject(payload),
  }));
  const stagesByTeam = teams.map(({ payload }) => publishedStages(payload));
  const labels = unique(stagesByTeam.flatMap((stages) => stages.map((stage) => stage.label)));
  const chosen = chosenStage !== null && labels.includes(chosenStage) ? chosenStage : labels[0];
  const stages = labels.map((label) => {
    const teamStages = stagesByTeam.map((stages) => stages.find((stage) => stage.label === label));
    const rows = unique(teamStages.flatMap((stage) => stage?.rows.map((row) => row.label) ?? [])).map((rowLabel) => {
      const teamRows = teamStages.map((stage) => stage?.rows.find((row) => row.label === rowLabel));
      const best = bestOnEachAlliance(columns, teamRows);
      return {
        label: rowLabel,
        explanation: teamRows.find((row) => row?.explanation)?.explanation ?? null,
        cells: teamRows.map((row, index) => columns[index].noData ? null : { text: row ? cellText(row.value) : "-", ...(best.has(index) ? { best: true } : {}) }),
      };
    });
    const totals = teamStages.some((stage) => stage?.total !== undefined) ? allianceSums(columns, teamStages.map((stage) => stage?.total ?? null)) : null;
    const notes = teams.map(({ payload }) => notesIn(payload, label));
    const cards = columns.map((column, index) => ({ column, notes: column.noData ? null : stageNotes(notes[index]) }));
    return { label, chosen: label === chosen, totals, rows, cardRows: notes.some(Boolean) ? cardRows(cards) : [] };
  });
  return {
    kind: "stats", columns, estimatedScores: allianceSums(columns, teams.map(({ payload }) => estimatedPoints(payload))), stages,
    eventBanner: eventBanner(packet, teams.map(({ team }) => team), lastFetch.answer),
  };
}

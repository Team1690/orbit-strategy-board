import type { JsonValue, MatchPacket, TeamStatsFetch } from "$lib/native/types";

import { isObject } from "./json";
import { packetLineup } from "./reassign";
import { OUR_TEAM, STATION_NAMES, STATIONS, stationAlliance, teamNumberKey, type AllianceColor, type StationKey } from "./stations";
import { resolveTeamColor, type TeamColorOverrides } from "./team-colors";

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
}

export interface StatsNotes {
  categories: StatsNoteCategory[];
}

export interface StatsCard {
  // headed like the team's column in the tables
  column: StatsColumn;
  notes: StatsNotes;
}

export interface StatsCardRow {
  alliance: AllianceColor;
  cards: StatsCard[];
}

export interface StatsStage {
  label: string;
  chosen: boolean;
  rows: StatsRow[];
  // a Stage of notes draws a card per team instead of a table
  cardRows: StatsCardRow[];
}

export type StatsView =
  | { kind: "loading" }
  | { kind: "notice"; title: string; detail: string | null }
  | { kind: "stats"; columns: StatsColumn[]; stages: StatsStage[] };

interface PublishedRow {
  label: string;
  explanation: string | null;
  value: JsonValue;
}

interface PublishedStage {
  label: string;
  rows: PublishedRow[];
}

function publishedRows(rows: JsonValue | undefined): PublishedRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => isObject(row) && typeof row.label === "string"
    ? [{ label: row.label, explanation: typeof row.explanation === "string" ? row.explanation : null, value: row.value ?? null }]
    : []);
}

function publishedStages(payload: JsonValue | undefined): PublishedStage[] {
  if (!isObject(payload) || !Array.isArray(payload.stages)) return [];
  return payload.stages.flatMap((stage) => isObject(stage) && typeof stage.label === "string" ? [{ label: stage.label, rows: publishedRows(stage.rows) }] : []);
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

function noteCategories(categories: unknown): StatsNoteCategory[] {
  if (!Array.isArray(categories)) return [];
  return categories.flatMap((category) => isObject(category) && typeof category.label === "string"
    ? [{
      label: category.label,
      stars: typeof category.stars === "number" ? category.stars : null,
      average: count(category.ratings) > 1,
      latest: typeof category.latest === "string" ? category.latest : "",
    }]
    : []);
}

function stageNotes(notes: Record<string, unknown> | null): StatsNotes {
  return { categories: noteCategories(notes?.categories) };
}

// grouped by alliance rather than cut at Blue 1 - a team added after its alliance still ends up in its row
function cardRows(cards: StatsCard[]): StatsCardRow[] {
  return (["red", "blue"] as const).flatMap((alliance) => {
    const row = cards.filter((card) => card.column.alliance === alliance);
    return row.length ? [{ alliance, cards: row }] : [];
  });
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
      return {
        label: rowLabel,
        explanation: teamRows.find((row) => row?.explanation)?.explanation ?? null,
        cells: teamRows.map((row, index) => columns[index].noData ? null : { text: row ? cellText(row.value) : "-" }),
      };
    });
    const notes = teams.map(({ payload }) => notesIn(payload, label));
    const cards = columns.map((column, index) => ({ column, notes: stageNotes(notes[index]) }));
    return { label, chosen: label === chosen, rows, cardRows: notes.some(Boolean) ? cardRows(cards) : [] };
  });
  return { kind: "stats", columns, stages };
}

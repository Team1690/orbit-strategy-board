import type { JsonValue, MatchPacket, TeamStatsFetch } from "$lib/native/types";

import { isObject } from "./json";
import { packetLineup } from "./reassign";
import { OUR_TEAM, STATION_NAMES, STATIONS, stationAlliance, teamNumberKey, type AllianceColor, type StationKey } from "./stations";
import { resolveTeamColor, type TeamColorOverrides } from "./team-colors";

export interface StatsViewInput {
  // null until the first fetch answers
  fetch: TeamStatsFetch | null;
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
}

export interface StatsCell {
  text: string;
}

export interface StatsRow {
  label: string;
  explanation: string | null;
  // one per column
  cells: StatsCell[];
}

export interface StatsStage {
  label: string;
  chosen: boolean;
  rows: StatsRow[];
}

export type StatsView = { kind: "stats"; columns: StatsColumn[]; stages: StatsStage[] };

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

function cellText(value: JsonValue): string {
  return isObject(value) && typeof value.text === "string" ? value.text : "-";
}

function unique(labels: string[]): string[] {
  return [...new Set(labels)];
}

export function statsView({ fetch, packet, chosenStage, teamColors, autoLighten }: StatsViewInput): StatsView {
  const lineup = packetLineup(packet);
  const published = new Map(fetch?.kind === "ok" ? fetch.answer.team_stats.map((team) => [String(team.team_number), team.payload]) : []);
  const columns = STATIONS.map((station) => {
    const team = lineup[station].trim();
    return {
      station, stationName: STATION_NAMES[station], alliance: stationAlliance(station),
      team, color: resolveTeamColor(team, teamColors, autoLighten), ourTeam: teamNumberKey(team) === OUR_TEAM,
    };
  });
  const stagesByTeam = columns.map((column) => publishedStages(published.get(teamNumberKey(column.team) ?? "")));
  const labels = unique(stagesByTeam.flatMap((stages) => stages.map((stage) => stage.label)));
  const chosen = chosenStage !== null && labels.includes(chosenStage) ? chosenStage : labels[0];
  const stages = labels.map((label) => {
    const teamStages = stagesByTeam.map((stages) => stages.find((stage) => stage.label === label));
    const rows = unique(teamStages.flatMap((stage) => stage?.rows.map((row) => row.label) ?? [])).map((rowLabel) => {
      const teamRows = teamStages.map((stage) => stage?.rows.find((row) => row.label === rowLabel));
      return {
        label: rowLabel,
        explanation: teamRows.find((row) => row?.explanation)?.explanation ?? null,
        cells: teamRows.map((row) => ({ text: row ? cellText(row.value) : "-" })),
      };
    });
    return { label, chosen: label === chosen, rows };
  });
  return { kind: "stats", columns, stages };
}

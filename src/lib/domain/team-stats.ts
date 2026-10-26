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

export interface StatsStage {
  label: string;
  chosen: boolean;
}

export type StatsView = { kind: "stats"; columns: StatsColumn[]; stages: StatsStage[] };

interface PublishedStage {
  label: string;
}

function publishedStages(payload: JsonValue | undefined): PublishedStage[] {
  if (!isObject(payload) || !Array.isArray(payload.stages)) return [];
  return payload.stages.flatMap((stage) => isObject(stage) && typeof stage.label === "string" ? [{ label: stage.label }] : []);
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
  const labels = [...new Set(stagesByTeam.flatMap((stages) => stages.map((stage) => stage.label)))];
  const chosen = chosenStage !== null && labels.includes(chosenStage) ? chosenStage : labels[0];
  return { kind: "stats", columns, stages: labels.map((label) => ({ label, chosen: label === chosen })) };
}

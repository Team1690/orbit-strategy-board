import type { AllianceColor, StatsView } from "$lib/domain";

export function drawnBrighter(shown: Extract<StatsView, { kind: "stats" }>, stageLabel: string, rowLabel: string): Record<AllianceColor, string[]> {
  const row = shown.stages.find((stage) => stage.label === stageLabel)?.rows.find((candidate) => candidate.label === rowLabel);
  if (!row) throw new Error(`no ${stageLabel} ${rowLabel} row`);
  const teams = (alliance: AllianceColor) => shown.columns.flatMap((column, index) => column.alliance === alliance && row.cells[index]?.best ? [column.team] : []);
  return { red: teams("red"), blue: teams("blue") };
}

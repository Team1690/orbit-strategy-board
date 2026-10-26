<script module lang="ts">
  // the panel is rebuilt for every Match - the picked Stage lives here so the next Match opens on it too
  let lastStage: string | null = null;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { statsView } from "$lib/domain";
  import { native } from "$lib/native/api";
  import type { MatchPacket, TeamStatsFetch } from "$lib/native/types";
  import { boardConfig } from "$lib/stores/config.svelte";

  let { packet }: { packet: MatchPacket } = $props();

  let lastFetch = $state.raw<TeamStatsFetch | null>(null);
  let chosenStage = $state(lastStage);
  let explained = $state<string | null>(null);

  const view = $derived(statsView({ lastFetch, packet, chosenStage, teamColors: boardConfig.current.teamColors, autoLighten: boardConfig.current.autoLighten }));
  const stage = $derived(view.kind === "stats" ? view.stages.find((candidate) => candidate.chosen) : undefined);

  function choose(label: string) {
    chosenStage = lastStage = label;
  }

  onMount(() => {
    native.teamStats.fetch().then(
      (result) => (lastFetch = result),
      (error: unknown) => (lastFetch = { kind: "unreachable", detail: error instanceof Error ? error.message : String(error) }),
    );
  });
</script>

<div id="stats-panel" class="flex flex-col flex-1 min-h-0">
  {#if view.kind === "loading"}
    <div class="flex flex-col flex-1 items-center justify-center gap-4 p-8" role="status">
      <div class="relative size-12">
        <div class="absolute inset-0 border-4 border-[#222] rounded-full"></div>
        <div class="absolute inset-0 border-4 border-[#888] rounded-full border-t-transparent animate-spin"></div>
      </div>
      <p class="text-lg font-semibold text-[#e8e8e8]">Loading Team Stats</p>
    </div>
  {:else if view.kind === "notice"}
    <div id="stats-notice" class="flex flex-col flex-1 items-center justify-center gap-2 p-8 text-center" role="status">
      <i class="fas fa-chart-simple text-5xl text-[#555] mb-2"></i>
      <h2 class="text-xl font-bold text-[#e8e8e8]">{view.title}</h2>
      {#if view.detail}
        <p class="max-w-md text-[#999]">{view.detail}</p>
      {/if}
    </div>
  {:else}
    <div id="stats-estimated-score" class="flex items-baseline justify-center gap-3 px-4 md:px-6 pt-4">
      <span class="caption">Estimated score</span>
      <span class="score red">{view.estimatedScores.red}</span>
      <span class="versus">vs</span>
      <span class="score blue">{view.estimatedScores.blue}</span>
    </div>
    <div id="stats-stages" class="flex flex-wrap gap-2 px-4 md:px-6 pt-4" role="tablist" aria-label="Stages">
      {#each view.stages as candidate (candidate.label)}
        <button class="stage-tab" class:chosen={candidate.chosen} role="tab" aria-selected={candidate.chosen} onclick={() => choose(candidate.label)}>{candidate.label}</button>
      {/each}
    </div>
    <div class="flex-1 min-h-0 overflow-auto touch-pan-x touch-pan-y p-4 md:p-6">
      <table id="stats-table">
        <thead>
          <tr>
            <th class="row-label" scope="col"><span class="sr-only">Row</span></th>
            {#each view.columns as column (column.station)}
              <th class="team-head {column.alliance}" scope="col">
                <span class="team-number" style:color={column.color}>{column.team}</span>
                <span class="station">
                  {column.stationName}
                  {#if column.ourTeam}
                    <i class="fas fa-star our-team" title="Our Team" aria-label="Our Team"></i>
                  {/if}
                </span>
                {#if column.noData}
                  <span class="no-data">No data</span>
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each stage?.rows ?? [] as row (row.label)}
            <tr>
              <th class="row-label" scope="row">
                <span class="label-line">
                  {row.label}
                  {#if row.explanation}
                    <button class="explain" aria-label={`What ${row.label} means`} aria-expanded={explained === row.label} onclick={() => (explained = explained === row.label ? null : row.label)}>
                      <i class="fas fa-circle-info"></i>
                    </button>
                  {/if}
                </span>
              </th>
              {#each row.cells as cell, index (view.columns[index].station)}
                <td class={view.columns[index].alliance} class:empty={cell === null}>{cell?.text ?? ""}</td>
              {/each}
            </tr>
            {#if row.explanation && explained === row.label}
              <tr class="explanation">
                <td colspan={view.columns.length + 1}>{row.explanation}</td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  #stats-estimated-score .caption {
    color: #777;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .score {
    font-size: 1.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .score.red { color: #c97070; }
  .score.blue { color: #6090c9; }
  .versus { color: #666; }

  .stage-tab {
    padding: 0.45rem 1.1rem;
    border: 1px solid #2a2a2a;
    border-radius: 999px;
    background: #181818;
    color: #999;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }
  .stage-tab:hover { background: #252525; color: #e8e8e8; }
  .stage-tab.chosen { background: #ebebeb; border-color: #ebebeb; color: #0d0d0d; }

  #stats-table {
    border-collapse: separate;
    border-spacing: 0;
    min-width: 100%;
    color: #e8e8e8;
  }
  #stats-table th,
  #stats-table td {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #1e1e1e;
    text-align: center;
    white-space: nowrap;
  }
  #stats-table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: #111111;
  }
  #stats-table .row-label {
    position: sticky;
    left: 0;
    z-index: 2;
    min-width: 10rem;
    background: #111111;
    color: #999;
    font-weight: 600;
    text-align: left;
  }
  #stats-table thead .row-label { z-index: 3; }
  .label-line {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .team-head {
    min-width: 7rem;
    border-top: 4px solid transparent;
  }
  .team-head.red { border-top-color: #dc2626; }
  .team-head.blue { border-top-color: #2563eb; }
  #stats-table .red + .blue { border-left: 2px solid #2a2a2a; }
  .team-head > span { display: block; }
  .team-number {
    font-size: 1.35rem;
    font-weight: 700;
  }
  .station {
    color: #777;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .team-head.red .station { color: #c97070; }
  .team-head.blue .station { color: #6090c9; }
  .our-team { margin-left: 0.25rem; color: #facc15; }
  .no-data {
    margin-top: 0.15rem;
    color: #777;
    font-size: 0.8rem;
    font-style: italic;
  }
  td.empty { background: #101010; }
  .explain {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: #777;
    cursor: pointer;
  }
  .explain:hover,
  .explain[aria-expanded="true"] { color: #e8e8e8; background: #1e1e1e; }
  #stats-table tr.explanation td {
    padding-top: 0;
    color: #999;
    font-size: 0.85rem;
    text-align: left;
    white-space: normal;
  }
</style>

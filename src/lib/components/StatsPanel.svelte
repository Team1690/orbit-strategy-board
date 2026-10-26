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

  const ALLIANCES = ["red", "blue"] as const;
  const REFRESH_MS = 60_000;
  const CLOCK_MS = 15_000;

  let lastFetch = $state.raw<TeamStatsFetch | null>(null);
  let chosenStage = $state(lastStage);
  let explained = $state<string | null>(null);
  let now = $state(Date.now());
  let requested = 0;
  let answered = 0;

  const view = $derived(statsView({ lastFetch, packet, chosenStage, teamColors: boardConfig.current.teamColors, autoLighten: boardConfig.current.autoLighten, now }));
  const stage = $derived(view.kind === "stats" ? view.stages.find((candidate) => candidate.chosen) : undefined);

  function choose(label: string) {
    chosenStage = lastStage = label;
  }

  // a request can hang on a dead connection while a newer one goes through - the newer answer wins
  async function refresh() {
    const request = ++requested;
    const result = await native.teamStats.fetch().catch((error: unknown): TeamStatsFetch => ({ kind: "unreachable", detail: error instanceof Error ? error.message : String(error), cached: null }));
    if (request < answered) return;
    answered = request;
    lastFetch = result;
    now = Date.now();
  }

  onMount(() => {
    // the numbers the tablet kept go up at once - on bad wi-fi the fetch can take its whole timeout
    native.teamStats.cached().then((cached) => {
      if (cached && !lastFetch) lastFetch = { kind: "ok", answer: cached.answer };
    }, () => undefined);
    void refresh();
    const refresher = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, REFRESH_MS);
    const clock = window.setInterval(() => (now = Date.now()), CLOCK_MS);
    return () => {
      window.clearInterval(refresher);
      window.clearInterval(clock);
    };
  });
</script>

<svelte:window ononline={() => void refresh()} />

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
    {#if view.eventBanner}
      <div id="stats-event-banner" class="flex items-center gap-3 mx-4 md:mx-6 mt-4 px-4 py-2.5" role="status">
        <i class="fas fa-triangle-exclamation text-[#eab308]" aria-hidden="true"></i>
        <p><span class="font-bold text-[#e8e8e8]">{view.eventBanner.title}</span> <span class="text-[#999]">{view.eventBanner.detail}</span></p>
      </div>
    {/if}
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
    <p id="stats-freshness" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 md:px-6 pt-3 text-sm" role="status">
      {#if view.freshness.unreachable}
        <span class="unreachable"><i class="fas fa-circle-exclamation" aria-hidden="true"></i> {view.freshness.unreachable.title}</span>
        <span class="unreachable-detail">{view.freshness.unreachable.detail}</span>
      {/if}
      <span class="confirmed"><i class="fa-regular fa-clock" aria-hidden="true"></i> {view.freshness.confirmed}</span>
    </p>
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
          {#if stage?.totals}
            <tr class="totals">
              <th class="row-label" scope="row">Alliance Total</th>
              {#each ALLIANCES as alliance (alliance)}
                {@const span = view.columns.filter((column) => column.alliance === alliance).length}
                {#if span}
                  <td class={alliance} colspan={span}>{stage.totals[alliance]}</td>
                {/if}
              {/each}
            </tr>
          {/if}
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
                <td class={view.columns[index].alliance} class:empty={cell === null} class:best={cell?.best}>{cell?.text ?? ""}</td>
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
  #stats-event-banner {
    border: 1px solid #4a3c0e;
    border-left: 4px solid #eab308;
    border-radius: 6px;
    background: #1a160a;
  }
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

  #stats-freshness .confirmed { color: #999; }
  #stats-freshness .unreachable { color: #e89090; font-weight: 600; }
  #stats-freshness .unreachable-detail { color: #777; }

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
  td.best {
    color: #ffffff;
    font-weight: 700;
  }
  td.best.red { background: rgba(220, 38, 38, 0.24); }
  td.best.blue { background: rgba(37, 99, 235, 0.28); }
  #stats-table tr.totals th,
  #stats-table tr.totals td { border-bottom: 2px solid #2a2a2a; }
  #stats-table tr.totals td {
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  #stats-table tr.totals td.red { color: #c97070; }
  #stats-table tr.totals td.blue { color: #6090c9; }
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

<script module lang="ts">
  // the panel is rebuilt for every Match - the picked Stage lives here so the next Match opens on it too
  let lastStage: string | null = null;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { statsView, type StatsColumn, type StatsMark } from "$lib/domain";
  import { native } from "$lib/native/api";
  import type { MatchPacket, TeamStatsFetch } from "$lib/native/types";
  import { boardConfig } from "$lib/stores/config.svelte";
  import StatsFaultList from "./StatsFaultList.svelte";
  import StatsTeamMarks from "./StatsTeamMarks.svelte";

  const MARKS: Record<StatsMark, string> = { "green check": "fa-check mark-green", "red cross": "fa-xmark mark-red", "grey cross": "fa-xmark mark-grey" };

  let { packet }: { packet: MatchPacket } = $props();

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

{#snippet teamHeader(column: StatsColumn)}
  <span class="team-number" style:color={column.color}>{column.team}</span>
  <span class="place">
    {column.placeName}
    {#if column.ourTeam}
      <i class="fas fa-star our-team" title="Our Team" aria-label="Our Team"></i>
    {/if}
  </span>
  <StatsTeamMarks {column} />
  {#if column.noData}
    <span class="no-data">No data</span>
  {/if}
{/snippet}

{#snippet explainToggle(label: string)}
  <button class="explain" aria-label={`What ${label} means`} aria-expanded={explained === label} onclick={() => (explained = explained === label ? null : label)}>
    <i class="fas fa-circle-info"></i>
  </button>
{/snippet}

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
      {#if stage?.cardRows.length}
        <div id="stats-cards">
          {#each stage.cardRows as cardRow (cardRow.alliance)}
            <div class="card-row">
              {#each cardRow.cards as card (card.column.place)}
                <article class="team-card" class:bench={card.column.bench}>
                  <header class="team-head {card.column.alliance}">{@render teamHeader(card.column)}</header>
                  {#if card.notes}
                    <div class="notes">
                      {#if card.notes.scouters || card.notes.defenseStarred}
                        <p class="card-marks">
                          {#if card.notes.scouters}
                            <span>{card.notes.scouters}</span>
                          {/if}
                          {#if card.notes.defenseStarred}
                            <span class="defense-starred"><i class="fas fa-star" aria-hidden="true"></i> Starred defense</span>
                          {/if}
                        </p>
                      {/if}
                      {#each card.notes.categories as category (category.label)}
                        <section>
                          <h3 class="category-head">
                            {category.label}
                            {#if category.stars !== null}
                              <span class="stars" role="img" aria-label={`${category.stars} of 5 stars`}>
                                {#each [1, 2, 3, 4, 5] as star (star)}
                                  <i class={star <= (category.stars ?? 0) ? "fas fa-star lit" : "fa-regular fa-star"} aria-hidden="true"></i>
                                {/each}
                              </span>
                              {#if category.average}
                                <span class="avg">avg</span>
                              {/if}
                            {/if}
                          </h3>
                          {#if category.latest}
                            <p class="latest" dir={category.dir}>{category.latest}</p>
                          {/if}
                          {#if category.more}
                            <p class="more">{category.more}</p>
                          {/if}
                        </section>
                      {:else}
                        <p class="no-notes">No notes</p>
                      {/each}
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          {/each}
        </div>
      {:else}
      <table id="stats-table">
        <thead>
          <tr>
            <th class="row-label" scope="col"><span class="sr-only">Row</span></th>
            {#each view.columns as column (column.place)}
              <th class="team-head {column.alliance}" class:bench={column.bench} scope="col">{@render teamHeader(column)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#if stage?.totals}
            <tr class="totals">
              <th class="row-label" scope="row">Alliance Total</th>
              {#each view.alliances as { alliance, stationSpan, bench } (alliance)}
                {#if stationSpan}
                  <td class={alliance} colspan={stationSpan}>{stage.totals[alliance]}</td>
                {/if}
                {#if bench}
                  <td class={alliance}></td>
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
                    {@render explainToggle(row.label)}
                  {/if}
                </span>
              </th>
              {#each row.cells as cell, index (view.columns[index].place)}
                <td class={view.columns[index].alliance} class:bench={view.columns[index].bench} class:empty={cell === null} class:best={cell?.best}>
                  {#if cell?.mark}
                    <i class="fas {MARKS[cell.mark]}" aria-hidden="true"></i>
                    <span class="sr-only">{cell.text}</span>
                  {:else}
                    {cell?.text ?? ""}
                  {/if}
                </td>
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
      {#each stage?.grids ?? [] as grid (grid.label)}
        <section class="stats-grid" aria-label={grid.label}>
          <h3 class="label-line grid-title">
            {grid.label}
            {#if grid.explanation}
              {@render explainToggle(grid.label)}
            {/if}
          </h3>
          {#if grid.explanation && explained === grid.label}
            <p class="grid-explanation">{grid.explanation}</p>
          {/if}
          <div class="grid-alliances">
            {#each view.alliances as { alliance, columnIndexes } (alliance)}
              <div class="grid-alliance">
                {#each columnIndexes as index (view.columns[index].place)}
                  {@const column = view.columns[index]}
                  {@const team = grid.teams[index]}
                  <figure class="grid-team {alliance}" class:bench={column.bench}>
                    <figcaption>
                      <span class="grid-team-number" style:color={column.color}>{column.team}</span>
                      <span class="place">{column.placeName}</span>
                    </figcaption>
                    {#if team}
                      <table class="small-grid">
                        <thead>
                          <tr>
                            <td></td>
                            {#each team.columns as heading, columnIndex (columnIndex)}
                              <th scope="col">{heading}</th>
                            {/each}
                          </tr>
                        </thead>
                        <tbody>
                          {#each team.rows as heading, rowIndex (rowIndex)}
                            <tr>
                              <th scope="row">{heading}</th>
                              {#each team.cells[rowIndex] as gridCell, cellIndex (cellIndex)}
                                <td class:zero={gridCell.zero}>{gridCell.text}</td>
                              {/each}
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {:else}
                      <p class="no-grid">{column.noData ? "No data" : "-"}</p>
                    {/if}
                  </figure>
                {/each}
              </div>
            {/each}
          </div>
        </section>
      {/each}
      {/if}
      {#if stage?.faults.length}
        <StatsFaultList teams={stage.faults} />
      {/if}
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
  .place {
    color: #777;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .team-head.red .place { color: #c97070; }
  .team-head.blue .place { color: #6090c9; }
  .our-team { margin-left: 0.25rem; color: #facc15; }
  .no-data {
    margin-top: 0.15rem;
    color: #777;
    font-size: 0.8rem;
    font-style: italic;
  }
  /* the sticky header stays opaque so rows scrolling under it never show through - only what's on it dims */
  #stats-table .team-head.bench > :global(*),
  td.bench,
  .grid-team.bench,
  .team-card.bench { opacity: 0.5; }
  #stats-table .team-head.bench.red { border-top-color: rgba(220, 38, 38, 0.5); }
  #stats-table .team-head.bench.blue { border-top-color: rgba(37, 99, 235, 0.5); }
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
  .mark-green { color: #4caf50; }
  .mark-red { color: #f44336; }
  .mark-grey { color: #9e9e9e; }
  .stats-grid { margin-top: 1.75rem; }
  .grid-title {
    margin: 0 0 0.75rem;
    color: #999;
    font-size: 1rem;
    font-weight: 600;
  }
  .grid-explanation {
    max-width: 40rem;
    margin: -0.25rem 0 0.75rem;
    color: #999;
    font-size: 0.85rem;
  }
  .grid-alliances {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem 2rem;
  }
  .grid-alliance {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .grid-team {
    margin: 0;
    padding: 0.5rem 0.75rem 0.6rem;
    border: 1px solid #1e1e1e;
    border-top: 4px solid transparent;
    border-radius: 6px;
    background: #141414;
  }
  .grid-team.red { border-top-color: #dc2626; }
  .grid-team.blue { border-top-color: #2563eb; }
  .grid-team figcaption {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }
  .grid-team-number {
    font-size: 1.1rem;
    font-weight: 700;
  }
  .grid-team.red .place { color: #c97070; }
  .grid-team.blue .place { color: #6090c9; }
  .small-grid {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  .small-grid th,
  .small-grid td {
    padding: 0.25rem 0.55rem;
    text-align: center;
    white-space: nowrap;
  }
  .small-grid th {
    color: #777;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .small-grid tbody th { padding-left: 0; text-align: left; }
  .small-grid td {
    color: #e8e8e8;
    font-weight: 600;
  }
  .small-grid td.zero { color: #3d3d3d; }
  .no-grid {
    min-width: 9rem;
    margin: 0;
    padding: 1.5rem 0;
    color: #777;
    font-style: italic;
    text-align: center;
  }

  #stats-cards {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .card-row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(15rem, 1fr);
    gap: 0.75rem;
    align-items: start;
  }
  .team-card {
    overflow: hidden;
    border: 1px solid #1e1e1e;
    border-radius: 6px;
    background: #141414;
    color: #e8e8e8;
  }
  .team-card .team-head {
    padding: 0.55rem 0.75rem;
    border-bottom: 1px solid #1e1e1e;
    background: #111111;
    text-align: center;
  }
  .notes {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 0.75rem 0.9rem 0.9rem;
  }
  .card-marks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    color: #999;
    font-size: 0.8rem;
    font-weight: 600;
  }
  .defense-starred {
    padding: 0.1rem 0.55rem;
    border: 1px solid #5c4d1a;
    border-radius: 999px;
    color: #d4af37;
  }
  .category-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    color: #999;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .stars {
    display: inline-flex;
    gap: 0.1rem;
    color: #555;
    font-size: 0.75rem;
  }
  .stars .lit { color: #ffc107; }
  .avg {
    color: #777;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .latest {
    margin-top: 0.25rem;
    line-height: 1.4;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .more {
    margin-top: 0.2rem;
    color: #777;
    font-size: 0.8rem;
  }
  .no-notes {
    color: #777;
    font-size: 0.85rem;
    font-style: italic;
  }
</style>

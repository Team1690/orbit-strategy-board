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

  const MARKS: Record<StatsMark, string> = { "green check": "fa-check mark-yes", "red cross": "fa-xmark mark-no", "grey cross": "fa-xmark mark-unknown" };

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

  function explain(label: string) {
    explained = explained === label ? null : label;
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
  <span class="team-line">
    <span class="team-number" style:color={column.color}>{column.team}</span>
    {#if column.ourTeam}
      <i class="fas fa-star our-team" role="img" aria-label="Our Team"></i>
    {/if}
  </span>
  <span class="place">{column.placeName}</span>
  {#if column.noData}
    <span class="no-data">No data</span>
  {/if}
  <StatsTeamMarks {column} />
{/snippet}

{#snippet rowLabel(label: string, explanation: string | null)}
  {#if explanation}
    <button class="explain" aria-expanded={explained === label} onclick={() => explain(label)}>
      <span>{label}</span>
      <i class="fa-regular fa-circle-question" aria-hidden="true"></i>
    </button>
  {:else}
    {label}
  {/if}
{/snippet}

{#snippet explanationRow(label: string, explanation: string | null, span: number)}
  {#if explanation && explained === label}
    <tr class="explanation">
      <td colspan={span}><p>{explanation}</p></td>
    </tr>
  {/if}
{/snippet}

<div id="stats-panel" class="flex flex-col flex-1 min-h-0">
  {#if view.kind === "loading"}
    <div class="stats-empty" role="status">
      <div class="spinner" aria-hidden="true"></div>
      <p>Loading Team Stats</p>
    </div>
  {:else if view.kind === "notice"}
    <div id="stats-notice" class="stats-empty" role="status">
      <i class="fas fa-chart-simple" aria-hidden="true"></i>
      <h2>{view.title}</h2>
      {#if view.detail}
        <p>{view.detail}</p>
      {/if}
    </div>
  {:else}
    <header id="stats-head">
      <div id="stats-stages" role="tablist" aria-label="Stages">
        {#each view.stages as candidate (candidate.label)}
          <button class="stage-tab" class:chosen={candidate.chosen} role="tab" aria-selected={candidate.chosen} onclick={() => choose(candidate.label)}>{candidate.label}</button>
        {/each}
      </div>
      <p id="stats-estimated-score">
        <span class="caption">Estimated score</span>
        <span class="score red">{view.estimatedScores.red}</span>
        <span class="versus">vs</span>
        <span class="score blue">{view.estimatedScores.blue}</span>
      </p>
    </header>
    <div id="stats-status">
      {#if view.eventBanner}
        <p id="stats-event-banner" class="notice warning" role="status">
          <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
          <strong>{view.eventBanner.title}</strong>
          <span>{view.eventBanner.detail}</span>
        </p>
      {/if}
      <p id="stats-freshness" role="status">
        {#if view.freshness.unreachable}
          <span class="notice error">
            <i class="fas fa-circle-exclamation" aria-hidden="true"></i>
            <strong>{view.freshness.unreachable.title}</strong>
            <span>{view.freshness.unreachable.detail}</span>
          </span>
        {/if}
        <span class="confirmed" class:stale={view.freshness.stale}><i class="fa-regular fa-clock" aria-hidden="true"></i> {view.freshness.confirmed}</span>
      </p>
    </div>
    <div class="stats-scroll flex-1 min-h-0 overflow-auto touch-pan-x touch-pan-y">
      <div class="stats-body">
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
        {@const span = view.columns.length + 1}
        <table id="stats-table" style:min-width={`calc(8.5rem + ${view.columns.length} * 5.75rem)`}>
          <colgroup>
            <col class="label-column" />
            {#each view.columns as column (column.place)}
              <col />
            {/each}
          </colgroup>
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
                    <td class="{alliance} bench"></td>
                  {/if}
                {/each}
              </tr>
            {/if}
            {#each stage?.rows ?? [] as row (row.label)}
              <tr>
                <th class="row-label" class:explainable={row.explanation !== null} scope="row">{@render rowLabel(row.label, row.explanation)}</th>
                {#each row.cells as cell, index (view.columns[index].place)}
                  <td class={view.columns[index].alliance} class:bench={view.columns[index].bench} class:best={cell?.best}>
                    {#if cell?.mark}
                      <i class="fas {MARKS[cell.mark]}" aria-hidden="true"></i>
                      <span class="sr-only">{cell.text}</span>
                    {:else if cell}
                      <span class="value" class:dash={cell.text === "-"}>{cell.text}</span>
                    {/if}
                  </td>
                {/each}
              </tr>
              {@render explanationRow(row.label, row.explanation, span)}
            {/each}
            {#each stage?.grids ?? [] as grid (grid.label)}
              <tr class="grid-head">
                <th class="row-label" class:explainable={grid.explanation !== null} scope="rowgroup">
                  {@render rowLabel(grid.label, grid.explanation)}
                  <span class="grid-columns">{grid.columns.join(" · ")}</span>
                </th>
                {#each view.columns as column, index (column.place)}
                  <td class={column.alliance} class:bench={column.bench}>
                    {#if !column.noData && !grid.lines[0]?.cells[index]}
                      <span class="value dash">-</span>
                    {/if}
                  </td>
                {/each}
              </tr>
              {@render explanationRow(grid.label, grid.explanation, span)}
              {#each grid.lines as line, lineIndex (line.label)}
                <tr class="grid-line" class:last={lineIndex === grid.lines.length - 1}>
                  <th class="row-label" scope="row">{line.label}</th>
                  {#each line.cells as cells, index (view.columns[index].place)}
                    <td class={view.columns[index].alliance} class:bench={view.columns[index].bench}>
                      {#if cells}
                        <span class="slots">
                          {#each cells as gridCell, cellIndex (cellIndex)}
                            <span class:zero={gridCell.zero}>{gridCell.text}</span>
                          {/each}
                        </span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      {/if}
      {#if stage?.faults.length}
        <StatsFaultList teams={stage.faults} />
      {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  #stats-panel {
    --text: #e8e8e8;
    --text-soft: #c8c8c8;
    --secondary: #999;
    --muted: #6e6e6e;
    --faint: #3a3a3a;
    --rule: #1c1c1c;
    --rule-strong: #2a2a2a;
    --red: #dc2626;
    --blue: #2563eb;
    --red-text: #c97070;
    --blue-text: #6090c9;
    --warning: #eab308;
    --error: #e89090;
    color: var(--text);
  }

  .stats-empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem;
    text-align: center;
  }
  .stats-empty i {
    margin-bottom: 0.5rem;
    color: var(--faint);
    font-size: 2rem;
  }
  .stats-empty h2 {
    font-size: 1.15rem;
    font-weight: 600;
  }
  .stats-empty p {
    max-width: 28rem;
    color: var(--secondary);
  }
  .spinner {
    width: 1.75rem;
    height: 1.75rem;
    margin-bottom: 0.25rem;
    border: 3px solid #222;
    border-top-color: #777;
    border-radius: 999px;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  #stats-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
    padding: 1rem 1.5rem 0;
  }
  #stats-stages {
    display: flex;
    gap: 0.125rem;
    padding: 0.25rem;
    border-radius: 10px;
    background: #151515;
  }
  .stage-tab {
    min-height: 2.5rem;
    padding: 0 1rem;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: #8a8a8a;
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }
  .stage-tab:hover { color: var(--text); }
  .stage-tab.chosen {
    background: #2a2a2a;
    color: #f4f4f4;
  }
  #stats-estimated-score {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }
  #stats-estimated-score .caption {
    margin-right: 0.25rem;
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .score {
    font-size: 1.6rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .score.red { color: var(--red-text); }
  .score.blue { color: var(--blue-text); }
  .versus {
    color: var(--muted);
    font-size: 0.85rem;
  }

  #stats-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 1rem;
    padding: 0.6rem 1.5rem 0.5rem;
    font-size: 0.8rem;
  }
  #stats-freshness {
    display: contents;
  }
  .confirmed { color: var(--muted); }
  .confirmed.stale { color: #b8962e; }
  .notice {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.45rem;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
  }
  .notice strong { font-weight: 600; }
  .notice span { color: var(--secondary); }
  .notice.warning { background: rgba(234, 179, 8, 0.1); }
  .notice.warning i,
  .notice.warning strong { color: var(--warning); }
  .notice.error { background: rgba(220, 38, 38, 0.12); }
  .notice.error i,
  .notice.error strong { color: var(--error); }

  /* the padding sits inside the scroll box - on the box itself the sticky header would stop short of its top and rows would show above it */
  .stats-body {
    padding: 0.25rem 1.5rem 1.5rem;
  }

  #stats-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: separate;
    border-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  .label-column { width: 8.5rem; }
  #stats-table th,
  #stats-table td {
    padding: 0.5rem 0.4rem;
    border-bottom: 1px solid var(--rule);
    text-align: center;
  }
  #stats-table td {
    color: var(--text-soft);
    font-size: 1rem;
    white-space: nowrap;
  }
  #stats-table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding-top: 0.6rem;
    border-bottom-color: var(--rule-strong);
    background: #0d0d0d;
    vertical-align: top;
  }
  #stats-table .row-label {
    position: sticky;
    left: 0;
    z-index: 2;
    padding-left: 0;
    background: #0d0d0d;
    color: var(--secondary);
    font-size: 0.9rem;
    font-weight: 500;
    line-height: 1.25;
    text-align: left;
  }
  #stats-table thead .row-label { z-index: 3; }
  #stats-table .red + .blue { border-left: 1px solid var(--rule-strong); }

  .team-head {
    border-top: 2px solid transparent;
  }
  #stats-table .team-head { white-space: normal; }
  .team-head.red { border-top-color: var(--red); }
  .team-head.blue { border-top-color: var(--blue); }
  .team-head > span { display: block; }
  .team-head > .team-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
  }
  .team-number {
    font-size: 1.3rem;
    font-weight: 700;
    line-height: 1.2;
  }
  .our-team {
    color: #facc15;
    font-size: 0.8rem;
  }
  .place {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .team-head.red .place { color: var(--red-text); }
  .team-head.blue .place { color: var(--blue-text); }
  .no-data {
    margin-top: 0.2rem;
    color: var(--muted);
    font-size: 0.78rem;
    font-style: italic;
  }
  /* the sticky header stays opaque so rows scrolling under it never show through - only what's on it dims */
  #stats-table .team-head.bench > :global(*),
  td.bench > *,
  .team-card.bench { opacity: 0.5; }
  #stats-table .team-head.bench.red { border-top-color: rgba(220, 38, 38, 0.4); }
  #stats-table .team-head.bench.blue { border-top-color: rgba(37, 99, 235, 0.4); }

  .value.dash { color: var(--faint); }
  td.best .value {
    display: inline-block;
    margin: -0.15rem 0;
    padding: 0.15rem 0.55rem;
    border-radius: 5px;
    color: #ffffff;
    font-weight: 700;
  }
  td.best.red .value { background: rgba(220, 38, 38, 0.26); }
  td.best.blue .value { background: rgba(37, 99, 235, 0.32); }

  #stats-table tr.totals > * { border-bottom-color: var(--rule-strong); }
  #stats-table tr.totals td {
    font-size: 1.15rem;
    font-weight: 700;
  }
  #stats-table tr.totals td.red { color: var(--red-text); }
  #stats-table tr.totals td.blue { color: var(--blue-text); }

  #stats-table .row-label.explainable { padding: 0; }
  .explain {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    min-height: 2.5rem;
    padding: 0.4rem 0.4rem 0.4rem 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .explain i {
    color: var(--muted);
    font-size: 0.8rem;
  }
  .explain[aria-expanded="true"],
  .explain[aria-expanded="true"] i { color: var(--text); }
  #stats-table tr.explanation td {
    padding: 0 0 0.6rem;
    white-space: normal;
  }
  tr.explanation p {
    position: sticky;
    left: 0;
    max-width: 36rem;
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    background: #151515;
    color: var(--secondary);
    font-size: 0.85rem;
    line-height: 1.4;
    text-align: left;
  }

  .mark-yes { color: #4caf50; }
  .mark-no { color: #e06666; }
  .mark-unknown { color: #5a5a5a; }

  #stats-table tr.grid-head > * {
    padding-top: 0.75rem;
    padding-bottom: 0.25rem;
    border-bottom: none;
    vertical-align: top;
  }
  #stats-table tr.grid-line > * {
    padding-top: 0.1rem;
    padding-bottom: 0.1rem;
    border-bottom: none;
  }
  #stats-table tr.grid-line.last > * {
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--rule);
  }
  #stats-table tr.grid-line .row-label {
    padding-left: 0.75rem;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .slots {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    max-width: 8rem;
    margin: 0 auto;
    font-size: 0.85rem;
  }
  .grid-columns {
    display: block;
    color: var(--muted);
    font-size: 0.72rem;
  }
  #stats-table .row-label.explainable .grid-columns { margin-top: -0.4rem; padding-bottom: 0.2rem; }
  tr.grid-line .slots {
    color: var(--text);
    font-weight: 600;
  }
  .slots .zero {
    color: var(--faint);
    font-weight: 400;
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

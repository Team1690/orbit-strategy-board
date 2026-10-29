<script module lang="ts">
  // the panel is rebuilt for every Match - the picked Stage lives here so the next Match opens on it too
  let lastStage: string | null = null;
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { plural, statsView, type StatsColumn, type StatsMark } from "$lib/domain";
  import { native } from "$lib/native/api";
  import type { MatchPacket, TeamStatsFetch } from "$lib/native/types";
  import { boardConfig } from "$lib/stores/config.svelte";
  import StatsFaultList from "./StatsFaultList.svelte";

  const MARKS: Record<StatsMark, string> = { "green check": "fa-check", "red cross": "fa-xmark", "grey cross": "fa-xmark faint" };

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
  // the columns left to right - null is the gap between the alliances
  const slots = $derived(view.kind === "stats" ? view.alliances.flatMap(({ columnIndexes }, order) => (order ? [null, ...columnIndexes] : columnIndexes)) : []);

  function choose(label: string) {
    chosenStage = lastStage = label;
  }

  function explain(label: string) {
    explained = explained === label ? null : label;
  }

  // a column too narrow for its tags' names draws them as dots rather than cutting a name off
  function fitTags(tags: HTMLElement) {
    const fit = () => {
      tags.classList.remove("dots");
      tags.classList.toggle("dots", tags.scrollWidth > tags.clientWidth);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(tags.closest("th") ?? tags);
    void document.fonts.ready.then(fit);
    return () => observer.disconnect();
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
  <span class="team-meta">
    <span>{column.placeName}</span>
    {#if column.activeFaults}
      <span class="fault-mark" role="img" aria-label={plural(column.activeFaults, "Active Fault")}><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>{column.activeFaults}</span>
    {/if}
    {#if column.robotTags.length}
      <span class="tags" {@attach fitTags}>
        {#each column.robotTags as tag}
          <span style:color={tag.color} dir={tag.dir} title={tag.name}>{tag.name}</span>
        {/each}
      </span>
    {/if}
    {#if column.noData}
      <span class="faint">No data</span>
    {/if}
  </span>
{/snippet}

{#snippet rowLabel(label: string, explanation: string | null)}
  {#if explanation}
    <button class="explain" aria-expanded={explained === label} onclick={() => explain(label)}><span>{label}</span></button>
  {:else}
    {label}
  {/if}
{/snippet}

{#snippet explanationRow(label: string, explanation: string | null)}
  {#if explanation && explained === label}
    <tr class="explanation">
      <td colspan={slots.length + 1}><p>{explanation}</p></td>
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
      <div id="stats-summary">
        <p id="stats-estimated-score">
          <span class="caption">Estimated score</span>
          <span class="red">{view.estimatedScores.red}</span><span class="faint" aria-hidden="true">·</span><span class="blue">{view.estimatedScores.blue}</span>
        </p>
        <p id="stats-status" role="status">
          {#if view.eventBanner}
            <span id="stats-event-banner"><span class="warning">{view.eventBanner.title}</span> {view.eventBanner.detail}</span>
          {/if}
          {#if view.freshness.unreachable}
            <span class="warning" title={view.freshness.unreachable.detail}>{view.freshness.unreachable.title}</span>
          {/if}
          <span class:warning={view.freshness.stale}>{view.freshness.confirmed}</span>
        </p>
      </div>
    </header>
    <div class="stats-scroll flex-1 min-h-0 overflow-auto touch-pan-x touch-pan-y">
      <div class="stats-body">
        <table id="stats-table" style:min-width={`calc(var(--label-width) + var(--gap-width) + ${view.columns.length} * ${stage?.notes.length ? "8rem" : "5.5rem"})`}>
          <colgroup>
            <col class="label-column" />
            {#each slots as index, slot (slot)}
              <col class:gap-column={index === null} />
            {/each}
          </colgroup>
          <thead>
            <tr>
              <th class="row-label" scope="col"><span class="sr-only">Row</span></th>
              {#each slots as index, slot (slot)}
                {#if index === null}
                  <td class="gap" aria-hidden="true"></td>
                {:else}
                  <th class="team-head" class:bench={view.columns[index].bench} scope="col">{@render teamHeader(view.columns[index])}</th>
                {/if}
              {/each}
            </tr>
          </thead>
          <tbody>
            {#if stage?.notes.length}
              <tr class="notes">
                <th class="row-label" scope="row"><span class="sr-only">Notes</span></th>
                {#each slots as index, slot (slot)}
                  {#if index === null}
                    <td class="gap" aria-hidden="true"></td>
                  {:else}
                    {@const notes = stage.notes[index]}
                    <td class:bench={view.columns[index].bench}>
                      {#if notes}
                        {#if notes.defenseStarred || notes.scouters}
                          <p class="note-meta">
                            {#if notes.defenseStarred}
                              <span class="defense-starred"><i class="fas fa-shield-halved" aria-hidden="true"></i> Starred defense</span>
                            {/if}
                            {#if notes.scouters}
                              <span>{notes.scouters}</span>
                            {/if}
                          </p>
                        {/if}
                        {#each notes.categories as category (category.label)}
                          <section class="category" dir={category.dir}>
                            <h3 dir="ltr">
                              {category.label}
                              {#if category.stars !== null}
                                <span class="rating">
                                  <span class="stars" role="img" aria-label={`${category.stars} of 5 stars`}>
                                    {#each [1, 2, 3, 4, 5] as star (star)}
                                      <i class="fas fa-star" class:lit={star <= (category.stars ?? 0)} aria-hidden="true"></i>
                                    {/each}
                                  </span>
                                  {#if category.average}
                                    avg
                                  {/if}
                                </span>
                              {/if}
                            </h3>
                            {#if category.latest}
                              <p class="latest">{category.latest}</p>
                            {/if}
                            {#if category.more}
                              <p class="more" dir="ltr">{category.more}</p>
                            {/if}
                          </section>
                        {:else}
                          <p class="faint">No notes</p>
                        {/each}
                      {/if}
                    </td>
                  {/if}
                {/each}
              </tr>
            {:else}
              {#if stage?.totals}
                <tr class="totals">
                  <th class="row-label" scope="row">Alliance Total</th>
                  {#each view.alliances as { alliance, stationSpan, bench }, order (alliance)}
                    {#if order}
                      <td class="gap" aria-hidden="true"></td>
                    {/if}
                    {#if stationSpan}
                      <td class={alliance} colspan={stationSpan}>{stage.totals[alliance]}</td>
                    {/if}
                    {#if bench}
                      <td></td>
                    {/if}
                  {/each}
                </tr>
              {/if}
              {#each stage?.rows ?? [] as row (row.label)}
                <tr>
                  <th class="row-label" scope="row">{@render rowLabel(row.label, row.explanation)}</th>
                  {#each slots as index, slot (slot)}
                    {#if index === null}
                      <td class="gap" aria-hidden="true"></td>
                    {:else}
                      {@const cell = row.cells[index]}
                      <td class:bench={view.columns[index].bench} class:best={cell?.best}>
                        {#if cell?.mark}
                          <i class="fas {MARKS[cell.mark]}" aria-hidden="true"></i>
                          <span class="sr-only">{cell.text}</span>
                        {:else if cell}
                          <span class:faint={cell.text === "-"}>{cell.text}</span>
                        {/if}
                      </td>
                    {/if}
                  {/each}
                </tr>
                {@render explanationRow(row.label, row.explanation)}
              {/each}
              {#each stage?.grids ?? [] as grid (grid.label)}
                <tr class="grid-head">
                  <th class="row-label" scope="rowgroup">
                    {@render rowLabel(grid.label, grid.explanation)}
                    <span class="grid-columns">{grid.columns.join(" · ")}</span>
                  </th>
                  {#each slots as index, slot (slot)}
                    {#if index === null}
                      <td class="gap" aria-hidden="true"></td>
                    {:else}
                      <td class:bench={view.columns[index].bench}>
                        {#if !view.columns[index].noData && !grid.lines[0]?.cells[index]}
                          <span class="faint">-</span>
                        {/if}
                      </td>
                    {/if}
                  {/each}
                </tr>
                {#each grid.lines as line (line.label)}
                  <tr class="grid-line">
                    <th class="row-label" scope="row">{line.label}</th>
                    {#each slots as index, slot (slot)}
                      {#if index === null}
                        <td class="gap" aria-hidden="true"></td>
                      {:else}
                        {@const cells = line.cells[index]}
                        <td class:bench={view.columns[index].bench}>
                          {#if cells}
                            <span class="slots">
                              {#each cells as gridCell, cellIndex (cellIndex)}
                                <span>
                                  {#if gridCell.zero}
                                    <span class="sr-only">{gridCell.text}</span>
                                  {:else}
                                    {gridCell.text}
                                  {/if}
                                </span>
                              {/each}
                            </span>
                          {/if}
                        </td>
                      {/if}
                    {/each}
                  </tr>
                {/each}
                {@render explanationRow(grid.label, grid.explanation)}
              {/each}
            {/if}
          </tbody>
        </table>
        {#if stage?.faults.length}
          <StatsFaultList teams={stage.faults} />
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  #stats-panel {
    --page: #0d0d0d;
    --hi: #ececec;
    --mid: #8c8c8c;
    --lo: #3c3c3c;
    --red: #ec6a63;
    --blue: #5f9cf0;
    --warning: #d4a33b;
    --large: 1.2rem;
    --medium: 0.95rem;
    --small: 0.78rem;
    --label-width: 7.5rem;
    --gap-width: 2rem;
    color: var(--mid);
    font-size: var(--medium);
    font-variant-numeric: tabular-nums;
  }

  .faint { color: var(--lo); }

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
  .stats-empty h2 {
    color: var(--hi);
    font-size: var(--medium);
    font-weight: 600;
  }
  .stats-empty p {
    max-width: 28rem;
    font-size: var(--small);
    line-height: 1.5;
  }
  .spinner {
    width: 1.25rem;
    height: 1.25rem;
    margin-bottom: 0.25rem;
    border: 2px solid var(--lo);
    border-top-color: var(--mid);
    border-radius: 999px;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  #stats-head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 2rem;
    padding: 1.1rem 1.5rem 0;
  }
  /* the tabs' padding is their touch target - the negative margin lines the first label up with the row labels */
  #stats-stages {
    display: flex;
    margin-left: -0.75rem;
  }
  .stage-tab {
    min-width: 0;
    padding: 0.35rem 0.75rem 0.6rem;
    border: none;
    background: none;
    color: var(--mid);
    font: inherit;
    font-size: var(--medium);
    font-weight: 500;
    cursor: pointer;
  }
  .stage-tab.chosen {
    color: var(--hi);
    text-decoration: underline 1.5px;
    text-underline-offset: 0.6em;
  }
  @media (hover: hover) {
    .stage-tab:hover { color: var(--hi); }
  }

  #stats-summary {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.3rem;
    margin-left: auto;
    text-align: right;
  }
  #stats-estimated-score {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    color: var(--hi);
    font-size: var(--large);
    font-weight: 600;
    line-height: 1.2;
  }
  #stats-estimated-score .caption {
    margin-right: 0.35rem;
    color: var(--mid);
    font-size: var(--small);
    font-weight: 400;
  }
  #stats-estimated-score .red { color: var(--red); }
  #stats-estimated-score .blue { color: var(--blue); }
  #stats-status {
    font-size: var(--small);
  }
  #stats-status > * + *::before {
    content: "·";
    margin: 0 0.5em;
    color: var(--lo);
  }
  #stats-status .warning { color: var(--warning); }

  /* the padding sits inside the scroll box - on the box itself the sticky header would stop short of its top and rows would show above it */
  .stats-body {
    padding: 0.5rem 1.5rem 2rem;
  }

  #stats-table {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }
  .label-column { width: var(--label-width); }
  .gap-column { width: var(--gap-width); }
  #stats-table th,
  #stats-table td {
    padding: 0.45rem 0.35rem;
    font-weight: 400;
    line-height: 1.35;
    text-align: center;
    white-space: nowrap;
  }
  #stats-table td.best {
    color: var(--hi);
    font-weight: 600;
  }
  #stats-table .row-label {
    position: sticky;
    left: 0;
    z-index: 1;
    padding-left: 0;
    background: var(--page);
    font-size: var(--small);
    text-align: left;
    white-space: normal;
  }

  #stats-table thead th,
  #stats-table thead td {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 0.5rem 0.2rem 0.9rem;
    background: var(--page);
    vertical-align: top;
  }
  #stats-table thead .row-label { z-index: 3; }
  #stats-table .team-head > span { display: block; }
  .team-line {
    position: relative;
    width: fit-content;
    margin: 0 auto;
  }
  .team-number {
    font-size: var(--large);
    font-weight: 700;
    line-height: 1.25;
  }
  /* hangs off the number so the number stays centered over its values */
  .our-team {
    position: absolute;
    top: 50%;
    left: 100%;
    margin-left: 0.3rem;
    color: var(--hi);
    font-size: 0.6rem;
    transform: translateY(-50%);
  }
  /* only the tags give way when a column is narrow - the Station and the fault mark always show */
  #stats-table .team-head > .team-meta {
    display: flex;
    justify-content: center;
    gap: 0.45em;
    margin-top: 0.15rem;
    font-size: var(--small);
  }
  .team-meta > * { flex: none; }
  .team-meta > .tags {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tags > * + * { margin-left: 0.35rem; }
  .tags:global(.dots) > span { font-size: 0; }
  .tags:global(.dots) > span::before {
    content: "";
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: currentColor;
  }
  .fault-mark { color: var(--red); }
  .fault-mark i {
    margin-right: 0.2em;
    font-size: 0.85em;
  }

  /* the sticky header stays opaque so rows scrolling under it never show through - only what's on it dims */
  #stats-table .bench > * { opacity: 0.4; }

  #stats-table tr.totals td {
    padding-bottom: 0.9rem;
    font-weight: 600;
  }
  #stats-table tr.totals .red { color: var(--red); }
  #stats-table tr.totals .blue { color: var(--blue); }
  #stats-table tr.totals .row-label { padding-bottom: 0.9rem; }

  .explain {
    display: block;
    width: 100%;
    min-height: 2.25rem;
    margin: -0.45rem 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .explain span {
    text-decoration: underline dotted var(--lo);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 0.3em;
  }
  .explain[aria-expanded="true"] { color: var(--hi); }
  #stats-table tr.explanation td {
    padding: 0 0 0.9rem;
    text-align: left;
    white-space: normal;
  }
  tr.explanation p {
    position: sticky;
    left: 0;
    max-width: 34rem;
    font-size: var(--small);
    line-height: 1.5;
  }

  #stats-table tr.grid-head > * {
    padding-top: 1.1rem;
    vertical-align: top;
  }
  #stats-table tr.grid-head .explain { margin-bottom: -0.6rem; }
  .grid-columns {
    display: block;
    color: var(--lo);
    font-size: var(--small);
  }
  #stats-table tr.grid-line > * {
    padding-top: 0.15rem;
    padding-bottom: 0.15rem;
  }
  #stats-table tr.grid-line .row-label { padding-left: 0.6rem; }
  .slots {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    max-width: 7.5rem;
    margin: 0 auto;
    font-size: var(--small);
  }

  #stats-table tr.notes td {
    padding-top: 0.25rem;
    white-space: normal;
    vertical-align: top;
  }
  .note-meta {
    margin-bottom: 1rem;
    font-size: var(--small);
  }
  .note-meta > * { display: block; }
  .defense-starred { color: var(--hi); }
  .category + .category { margin-top: 1.1rem; }
  .category h3 {
    font-size: var(--small);
    font-weight: 400;
  }
  .rating {
    margin-left: 0.2rem;
    white-space: nowrap;
  }
  .stars {
    display: inline-flex;
    gap: 0.1rem;
    margin-right: 0.1rem;
    color: var(--lo);
    font-size: 0.55rem;
    vertical-align: 0.1em;
  }
  .stars .lit { color: var(--mid); }
  .latest {
    margin-top: 0.2rem;
    color: var(--hi);
    line-height: 1.45;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .more {
    margin-top: 0.15rem;
    font-size: var(--small);
  }
  #stats-table tr.notes .faint { font-size: var(--small); }
</style>

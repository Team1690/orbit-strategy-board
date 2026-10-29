<script lang="ts">
  import type { StatsTeamFaults } from "$lib/domain";

  let { teams }: { teams: StatsTeamFaults[] } = $props();
</script>

<section id="stats-faults" aria-labelledby="stats-faults-title">
  <h3 id="stats-faults-title">Active Faults</h3>
  <ul>
    {#each teams as { column, faults } (column.place)}
      <li class="fault-team" class:bench={column.bench}>
        <p class="team">
          <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
          <span style:color={column.color}>{column.team}</span>
        </p>
        <ul>
          {#each faults as fault}
            <li class="fault">
              <span>{fault.match}</span>
              <div>
                <p>
                  <span class="message" dir={fault.messageDir}>{fault.message}</span>
                  <span class="status">{fault.status}{fault.scouters ? ` · ${fault.scouters}` : ""}</span>
                </p>
                {#if fault.resolution}
                  <p dir={fault.resolutionDir}>{fault.resolution}</p>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>
</section>

<style>
  #stats-faults {
    max-width: 48rem;
    margin-top: 2.25rem;
    color: var(--mid);
    font-size: var(--medium);
    line-height: 1.4;
  }
  h3 {
    margin-bottom: 0.75rem;
    font-size: var(--small);
    font-weight: 400;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .fault-team {
    display: grid;
    grid-template-columns: var(--label-width) 1fr;
  }
  .fault-team + .fault-team { margin-top: 0.9rem; }
  .fault-team.bench { opacity: 0.4; }
  .team {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    font-weight: 700;
  }
  .team i {
    color: var(--red);
    font-size: 0.7rem;
  }
  .fault-team > ul {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .fault {
    display: grid;
    grid-template-columns: 3rem 1fr;
    gap: 1rem;
    align-items: baseline;
  }
  .message { color: var(--hi); }
  .status {
    margin-left: 0.6rem;
    font-size: var(--small);
    white-space: nowrap;
  }
</style>

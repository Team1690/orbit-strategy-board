<script lang="ts">
  import type { StatsTeamFaults } from "$lib/domain";

  let { teams }: { teams: StatsTeamFaults[] } = $props();
</script>

<section id="stats-faults" aria-labelledby="stats-faults-title">
  <h3 id="stats-faults-title"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>Active Faults</h3>
  <ul>
    {#each teams as { column, faults } (column.place)}
      <li class="fault-team" class:bench={column.bench}>
        <p class="team">
          <span class="team-number" style:color={column.color}>{column.team}</span>
          <span class="place {column.alliance}">{column.placeName}</span>
        </p>
        <ul>
          {#each faults as fault}
            <li class="fault">
              <span class="match">{fault.match}</span>
              <div>
                <p class="message" dir={fault.messageDir}>{fault.message}</p>
                {#if fault.resolution}
                  <p class="resolution" dir={fault.resolutionDir}>{fault.resolution}</p>
                {/if}
              </div>
              <span class="status">
                {fault.status}
                {#if fault.scouters}
                  <span class="scouters">· {fault.scouters}</span>
                {/if}
              </span>
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ul>
</section>

<style>
  #stats-faults {
    max-width: 52rem;
    margin-top: 2rem;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #2a2a2a;
    color: #e89090;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .fault-team {
    display: grid;
    grid-template-columns: 7.5rem 1fr;
    gap: 1rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid #1c1c1c;
  }
  .fault-team.bench { opacity: 0.5; }
  .team {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
  }
  .team-number {
    font-size: 1.05rem;
    font-weight: 700;
  }
  .place {
    font-size: 0.75rem;
    font-weight: 600;
  }
  .place.red { color: #c97070; }
  .place.blue { color: #6090c9; }
  .fault-team > ul {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .fault {
    display: grid;
    grid-template-columns: 3rem 1fr auto;
    gap: 0.75rem;
    align-items: baseline;
  }
  .match {
    color: #e8e8e8;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .message {
    color: #e8e8e8;
    line-height: 1.35;
  }
  .resolution {
    margin-top: 0.1rem;
    color: #999;
    font-size: 0.85rem;
    line-height: 1.35;
  }
  .status {
    color: #999;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .scouters { color: #6e6e6e; }
</style>

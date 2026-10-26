<script lang="ts">
  import { textDirection, type StatsTeamFaults } from "$lib/domain";

  let { teams }: { teams: StatsTeamFaults[] } = $props();
</script>

<section id="stats-faults" aria-labelledby="stats-faults-title">
  <h3 id="stats-faults-title"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>Active Faults</h3>
  <div class="fault-teams">
    {#each teams as { column, faults } (column.station)}
      <div class="fault-team">
        <div class="fault-team-head">
          <span class="team-number" style:color={column.color}>{column.team}</span>
          <span class="station {column.alliance}">{column.stationName}</span>
        </div>
        <ul>
          {#each faults as fault}
            <li>
              <div class="fault-line">
                <span class="match">{fault.match}</span>
                <span class="status">{fault.status}</span>
                {#if fault.scouters}
                  <span class="scouters">{fault.scouters}</span>
                {/if}
              </div>
              <p class="message" dir={textDirection(fault.message)}>{fault.message}</p>
              {#if fault.resolution}
                <p class="resolution" dir={textDirection(fault.resolution)}>{fault.resolution}</p>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  </div>
</section>

<style>
  #stats-faults {
    margin-top: 1.5rem;
    color: #e8e8e8;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.75rem;
    color: #e89090;
    font-size: 1rem;
    font-weight: 700;
  }
  .fault-teams {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    gap: 0.75rem;
  }
  .fault-team {
    padding: 0.75rem 0.9rem;
    border: 1px solid #1e1e1e;
    border-left: 3px solid #dc2626;
    border-radius: 6px;
    background: #141414;
  }
  .fault-team-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .team-number {
    font-size: 1.15rem;
    font-weight: 700;
  }
  .station {
    font-size: 0.8rem;
    font-weight: 600;
  }
  .station.red { color: #c97070; }
  .station.blue { color: #6090c9; }
  ul {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .fault-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .match {
    font-weight: 800;
  }
  .status {
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    background: #2a1414;
    color: #e89090;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .scouters {
    margin-left: auto;
    color: #999;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .message {
    margin: 0.3rem 0 0;
    line-height: 1.35;
  }
  .resolution {
    margin: 0.2rem 0 0;
    color: #999;
    font-size: 0.85rem;
    line-height: 1.35;
  }
</style>

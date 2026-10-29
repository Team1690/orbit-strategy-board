<script lang="ts">
  import { plural, type StatsColumn } from "$lib/domain";

  let { column }: { column: StatsColumn } = $props();
</script>

{#if column.activeFaults || column.robotTags.length}
  <div class="marks">
    {#if column.activeFaults}
      <span class="fault-marker" role="img" aria-label={plural(column.activeFaults, "Active Fault")}>
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>{column.activeFaults}
      </span>
    {/if}
    {#each column.robotTags as tag}
      <span class="tag" style:--tag={tag.color} dir={tag.dir}>{tag.name}</span>
    {/each}
  </div>
{/if}

<style>
  .marks {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.25rem;
    max-width: 10rem;
    margin: 0.4rem auto 0;
    white-space: normal;
  }
  .fault-marker,
  .tag {
    padding: 0.05rem 0.4rem;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1.4;
  }
  .fault-marker {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    background: rgba(220, 38, 38, 0.18);
    color: #f07a7a;
    font-weight: 700;
  }
  .fault-marker i { font-size: 0.65rem; }
  .tag {
    max-width: 100%;
    overflow: hidden;
    background: color-mix(in srgb, var(--tag) 14%, transparent);
    color: var(--tag);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

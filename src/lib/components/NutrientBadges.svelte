<script lang="ts">
  import { calculateKcal } from '$lib/utils';

  export let totals: {
    protein?: number | null;
    fat?: number | null;
    carbs?: number | null;
    fibers?: number | null;
    sugar?: number | null;
    mufa?: number | null;
    pufa?: number | null;
    sfa?: number | null;
    gl?: number | null;
    omega3?: number | null;
    omega6?: number | null;
  };
  export let ratio: string | undefined = undefined;
  export let pointerEventsNone: boolean = false;

  const r = (v?: number | null) => Math.round(v ?? 0);
</script>

<div class="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
  <span
    class="bg-blue-200 text-blue-900 px-1 py-0.5 rounded-md font-medium"
    class:pointer-events-none={pointerEventsNone}
  >
    {calculateKcal(totals)} C
  </span>
  <span
    class="bg-green-200 text-green-900 px-1 py-0.5 rounded-md font-medium"
    class:pointer-events-none={pointerEventsNone}
  >
    {r(totals.protein)}, {r(totals.fat)}, {r(totals.carbs)}
    <span class="text-green-700 text-[0.65rem]">PFC</span>
  </span>
  <span
    class="bg-yellow-200 text-yellow-900 px-1 py-0.5 rounded-md font-medium"
    class:pointer-events-none={pointerEventsNone}
  >
    {r(totals.fibers)}, {r(totals.sugar)}
    <span class="text-yellow-700 text-[0.65rem]">FiS</span>
  </span>
  <span
    class="bg-orange-200 text-orange-900 px-1 py-0.5 rounded-md font-medium"
    class:pointer-events-none={pointerEventsNone}
  >
    {r(totals.mufa)}, {r(totals.pufa)}, {r(totals.sfa)}
    <span class="text-orange-700 text-[0.65rem]">MPS</span>
  </span>
  <span
    class="bg-orange-200 text-orange-900 px-1 py-0.5 rounded-md font-medium"
    class:pointer-events-none={pointerEventsNone}
    title="Omega-6:Omega-3 Ratio"
  >
    {ratio ?? '-'}
    <span class="text-orange-700 text-[0.65rem]">6:3</span>
  </span>
  <span
    class="bg-purple-200 text-purple-900 px-1 py-0.5 rounded-md font-medium"
    class:pointer-events-none={pointerEventsNone}
  >
    {r(totals.gl)} GL
  </span>
</div>

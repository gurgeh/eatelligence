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
		class="rounded-md bg-blue-200 px-1 py-0.5 font-medium text-blue-900"
		class:pointer-events-none={pointerEventsNone}
	>
		{calculateKcal(totals)} C
	</span>
	<span
		class="rounded-md bg-green-200 px-1 py-0.5 font-medium text-green-900"
		class:pointer-events-none={pointerEventsNone}
	>
		{r(totals.protein)}, {r(totals.fat)}, {r(totals.carbs)}
		<span class="text-[0.65rem] text-green-700">PFC</span>
	</span>
	<span
		class="rounded-md bg-yellow-200 px-1 py-0.5 font-medium text-yellow-900"
		class:pointer-events-none={pointerEventsNone}
	>
		{r(totals.fibers)}, {r(totals.sugar)}
		<span class="text-[0.65rem] text-yellow-700">FiS</span>
	</span>
	<span
		class="rounded-md bg-orange-200 px-1 py-0.5 font-medium text-orange-900"
		class:pointer-events-none={pointerEventsNone}
	>
		{r(totals.mufa)}, {r(totals.pufa)}, {r(totals.sfa)}
		<span class="text-[0.65rem] text-orange-700">MPS</span>
	</span>
	<span
		class="rounded-md bg-orange-200 px-1 py-0.5 font-medium text-orange-900"
		class:pointer-events-none={pointerEventsNone}
		title="Omega-6:Omega-3 Ratio"
	>
		{ratio ?? '-'}
		<span class="text-[0.65rem] text-orange-700">6:3</span>
	</span>
	<span
		class="rounded-md bg-purple-200 px-1 py-0.5 font-medium text-purple-900"
		class:pointer-events-none={pointerEventsNone}
	>
		{r(totals.gl)} GL
	</span>
</div>

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

<div class="flex flex-wrap items-center gap-1 text-xs">
	<span
		class="rounded-md bg-indigo-100 px-1.5 py-0.5 font-semibold text-indigo-800 tabular-nums"
		class:pointer-events-none={pointerEventsNone}
	>
		{calculateKcal(totals)} <span class="text-[0.65rem] font-medium text-indigo-500">C</span>
	</span>
	<span
		class="rounded-md bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 tabular-nums"
		class:pointer-events-none={pointerEventsNone}
	>
		{r(totals.protein)}, {r(totals.fat)}, {r(totals.carbs)}
		<span class="text-[0.65rem] font-normal text-emerald-600">PFC</span>
	</span>
	<span
		class="rounded-md bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 tabular-nums"
		class:pointer-events-none={pointerEventsNone}
	>
		{r(totals.fibers)}, {r(totals.sugar)}
		<span class="text-[0.65rem] font-normal text-amber-600">FiS</span>
	</span>
	<span
		class="rounded-md bg-orange-100 px-1.5 py-0.5 font-medium text-orange-800 tabular-nums"
		class:pointer-events-none={pointerEventsNone}
	>
		{r(totals.mufa)}, {r(totals.pufa)}, {r(totals.sfa)}
		<span class="text-[0.65rem] font-normal text-orange-600">MPS</span>
	</span>
	<span
		class="rounded-md bg-sky-100 px-1.5 py-0.5 font-medium text-sky-800 tabular-nums"
		class:pointer-events-none={pointerEventsNone}
		title="Omega-6:Omega-3 Ratio"
	>
		{ratio ?? '-'}
		<span class="text-[0.65rem] font-normal text-sky-600">6:3</span>
	</span>
	<span
		class="rounded-md bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800 tabular-nums"
		class:pointer-events-none={pointerEventsNone}
	>
		{r(totals.gl)} <span class="text-[0.65rem] font-normal text-violet-600">GL</span>
	</span>
</div>

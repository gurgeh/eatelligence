<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { NutritionTarget } from '$lib/types';
	import TargetProgressBar from './TargetProgressBar.svelte';
    import { calculateKcal } from '$lib/utils'; // Assuming calculateKcal exists

	export let isOpen: boolean = false;
	export let dailyTotals: { [key: string]: number } = {}; // e.g., { protein: 150, fat: 80, ... }
	export let targets: NutritionTarget[] = [];
	export let dateString: string = ''; // e.g., "2025-05-02"

	const dispatch = createEventDispatcher();

	// --- Nutrient Kcal Multipliers (ensure these match utils.ts) ---
    // Re-fetch or pass these if they become dynamic
	const kcalMultipliers: { [key: string]: number } = {
		protein: 3,
		fat: 9,
		carbs: 3.7, // Net carbs (carbs - fibers)
        fibers: 2,
        // Other nutrients don't directly contribute kcal in this model
	};

	// --- Calculation Logic ---
	interface CalculatedTarget extends NutritionTarget {
		actualValue: number | null;
		displayUnit: string;
		displayLabel: string;
        calculationError: string | null;
        // Add display range properties
        displayMin: number;
        displayMax: number;
	}

	$: calculatedTargets = calculateAllTargets(targets, dailyTotals);

    // Helper to safely get nutrient value from daily totals
    function getNutrientTotal(nutrient: string | null, totals: { [key: string]: number }): number {
        if (!nutrient || totals[nutrient] === undefined || totals[nutrient] === null) {
            return 0;
        }
        return totals[nutrient];
    }

    // Helper to get the base value (grams or kcal) for calculations
    // Note: This logic needs careful alignment with how dailyTotals are structured
    function getBaseValue(nutrient: string | null, totals: { [key: string]: number }): number {
        if (!nutrient) return 0;

        const nutrientTotal = getNutrientTotal(nutrient, totals);

        if (nutrient === 'calories') {
            // Recalculate calories from macros if not directly present or to ensure consistency
            return calculateKcal({
                protein: getNutrientTotal('protein', totals),
                fat: getNutrientTotal('fat', totals),
                carbs: getNutrientTotal('carbs', totals),
                fibers: getNutrientTotal('fibers', totals)
            });
        }
        // For P/F/C used in % calculations, we need their kcal contribution
        if (nutrient === 'protein' || nutrient === 'fat' || nutrient === 'carbs' || nutrient === 'fibers') {
             // If we need kcal value for percentage calculation denominator (like fat % of kcal)
             // we calculate it. Otherwise, we usually want grams.
             // Let's refine this: the calculation function will handle kcal conversion if needed.
             // This function should primarily return the raw nutrient total (usually grams).
             return nutrientTotal; // Return grams by default
        }

        // For other nutrients (sugar, mufa, pufa, sfa, omega3, omega6, gl), return grams
        return nutrientTotal;
    }


	function calculateAllTargets(targetDefs: NutritionTarget[], totals: { [key: string]: number }): CalculatedTarget[] {
		if (!totals || Object.keys(totals).length === 0) return [];

        // Ensure we have a calculated total calorie value available
        const totalCalories = calculateKcal({
            protein: getNutrientTotal('protein', totals),
            fat: getNutrientTotal('fat', totals),
            carbs: getNutrientTotal('carbs', totals),
            fibers: getNutrientTotal('fibers', totals)
        });
        // Add it to the totals object if not present, for easier lookup
        const effectiveTotals = { ...totals, calories: totalCalories };


		return targetDefs.map(target => {
			let actualValue: number | null = null;
			let displayUnit: string = 'g'; // Default unit
            let calculationError: string | null = null;
            let displayMin: number = 0; // Default display range
            let displayMax: number = 100; // Default display range

			try {
                const n1 = target.nutrient_1;
                const n2 = target.nutrient_2;

                if (n2 === null) {
                    // Absolute Target
                    actualValue = getNutrientTotal(n1, effectiveTotals); // Get direct value (usually grams)
                    displayUnit = n1 === 'calories' ? 'kcal' : 'g';
                } else {
                    // Relative Target (%)
                    displayUnit = '%';
                    const value1 = getNutrientTotal(n1, effectiveTotals); // Grams of nutrient 1
                    let value2 = getNutrientTotal(n2, effectiveTotals); // Grams (or kcal if n2='calories') of nutrient 2

                    // --- Specific Logic for Relative Calculations ---
                    let calcValue1 = value1;
                    let calcValue2 = value2;

                    // 1. Percentage of Calories (P/F/C % of kcal)
                    if (n2 === 'calories') {
                        // Need kcal contribution of nutrient 1
                        if (n1 === 'protein' || n1 === 'fat' || n1 === 'carbs' || n1 === 'fibers') {
                            const netCarbs = getNutrientTotal('carbs', effectiveTotals) - getNutrientTotal('fibers', effectiveTotals);
                            if (n1 === 'protein') calcValue1 = value1 * kcalMultipliers.protein;
                            else if (n1 === 'fat') calcValue1 = value1 * kcalMultipliers.fat;
                            else if (n1 === 'carbs') calcValue1 = netCarbs * kcalMultipliers.carbs; // Use net carbs for kcal calc
                            else if (n1 === 'fibers') calcValue1 = value1 * kcalMultipliers.fibers;
                        } else {
                             throw new Error(`Cannot calculate kcal % for ${n1}`);
                        }
                        calcValue2 = effectiveTotals.calories; // Use total calculated calories
                    }
                    // 2. Percentage of Total Fat (MUFA/PUFA/SFA % of fat)
                    else if (n2 === 'fat' && ['mufa', 'pufa', 'sfa'].includes(n1)) {
                        // Both values are already in grams, direct ratio is fine
                        calcValue1 = value1;
                        calcValue2 = value2;
                    }
                     // 3. Ratios (O6:O3, PUFA:SFA) - both values in grams
                    else if ((n1 === 'omega6' && n2 === 'omega3') || (n1 === 'pufa' && n2 === 'sfa')) {
                         calcValue1 = value1;
                         calcValue2 = value2;
                    }
                    else {
                        // Potentially unsupported relative target defined
                         throw new Error(`Unsupported relative target: ${n1} / ${n2}`);
                    }


                    // Perform the percentage calculation
                    if (calcValue2 === 0) {
                        actualValue = null; // Or Infinity? Null seems safer.
                        calculationError = `Cannot calculate ratio/percentage: Denominator (${n2}) is zero.`;
                    } else {
                        actualValue = (calcValue1 / calcValue2) * 100;
                    }
                }

                // --- Calculate Display Range (Revised Logic) ---
                const safeActualValue = actualValue ?? 0; // Use 0 if actualValue is null for padding calculation
                const paddedMax = safeActualValue * 1.05;

                if (n2 === null) { // Absolute Target
                    displayMin = 0; // Always start at 0
                    const minT = target.min_value;
                    const maxT = target.max_value;
                    let initialMax = 100; // Default initial max if no target range

                    if (maxT !== null) {
                        initialMax = maxT * 1.2;
                    } else if (minT !== null) {
                        initialMax = minT * 2;
                    }
                    // Ensure initialMax is at least slightly positive if based on 0 target
                    if (initialMax <= 0) initialMax = 10;

                    displayMax = Math.max(initialMax, paddedMax);
                    // Ensure displayMax is at least a small positive number
                    if (displayMax <= 0) displayMax = 10;

                } else { // Relative Target (%)
                    displayMin = 0; // Always start at 0
                    let initialMax = 100; // Default 0-100%

                    if (n1 === 'omega6' && n2 === 'omega3') { // Special case for O6:O3
                        if (target.max_value !== null) {
                            initialMax = target.max_value * 2;
                        } else {
                            initialMax = 10000; // Default high upper limit
                        }
                    }
                    // Ensure initialMax is positive
                    if (initialMax <= 0) initialMax = 100; // Fallback for relative

                    displayMax = Math.max(initialMax, paddedMax);
                     // Ensure displayMax is positive
                    if (displayMax <= 0) displayMax = 100; // Fallback for relative
                }

                // --- Apply Custom Rounding to displayMax ---
                if (displayMax < 30) {
                    displayMax = Math.ceil(displayMax);
                } else if (displayMax < 300) {
                    displayMax = Math.ceil(displayMax / 10) * 10;
                } else if (displayMax < 3500) {
                    displayMax = Math.ceil(displayMax / 100) * 100;
                } else {
                    displayMax = Math.ceil(displayMax / 1000) * 1000;
                }

            } catch (err: any) {
                 console.error(`Error calculating target ${target.nutrient_1}/${target.nutrient_2}:`, err);
                 calculationError = err.message || "Calculation failed";
                 actualValue = null;
            }


			return {
				...target,
				actualValue: actualValue,
				displayUnit: displayUnit,
				displayLabel: generateTargetLabel(target.nutrient_1, target.nutrient_2), // Use helper
                calculationError: calculationError,
                displayMin: displayMin,
                displayMax: displayMax
			};
		});
	}

	// --- Helper to Generate Labels (copied from settings page for consistency) ---
	// TODO: Move this to utils.ts to avoid duplication
    const relativeTargetMappings: { [key: string]: { label: string; n1: string; n2: string } } = {
		protein_percent_calories: { label: 'Protein (% of Calories)', n1: 'protein', n2: 'calories' },
		fat_percent_calories: { label: 'Fat (% of Calories)', n1: 'fat', n2: 'calories' },
		carbs_percent_calories: { label: 'Carbs (% of Calories)', n1: 'carbs', n2: 'calories' },
		omega6_omega3_ratio: { label: 'Omega-6 / Omega-3 Ratio (%)', n1: 'omega6', n2: 'omega3' },
		pufa_sfa_ratio: { label: 'PUFA / SFA Ratio (%)', n1: 'pufa', n2: 'sfa' },
		mufa_percent_fat: { label: 'MUFA (% of Total Fat)', n1: 'mufa', n2: 'fat' },
		pufa_percent_fat: { label: 'PUFA (% of Total Fat)', n1: 'pufa', n2: 'fat' },
		sfa_percent_fat: { label: 'SFA (% of Total Fat)', n1: 'sfa', n2: 'fat' }
	};
	function generateTargetLabel(n1: string, n2: string | null): string {
		if (n2 === null) {
			// Absolute
			const unit = n1 === 'calories' ? 'kcal' : 'g';
			return `${n1.charAt(0).toUpperCase() + n1.slice(1)} (${unit})`;
		} else {
			// Relative - find the matching label from mappings
			const mappingKey = Object.keys(relativeTargetMappings).find(
				key => relativeTargetMappings[key].n1 === n1 && relativeTargetMappings[key].n2 === n2
			);
			// Fallback label includes unit (%)
			return mappingKey ? relativeTargetMappings[mappingKey].label : `${n1} / ${n2} (%)`;
		}
	}

	function closeModal() {
		dispatch('close');
	}

	// Close modal on escape key press
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeModal();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown}/>

{#if isOpen}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- The main keyboard interaction for closing is the Escape key handled globally. -->
	<!-- Clicking the backdrop is a secondary convenience. -->
	<div class="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center" on:click={closeModal}>
		<!-- Modal Content -->
		<div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto z-50" on:click|stopPropagation role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
			<div class="flex justify-between items-center mb-4">
				<h2 class="text-xl font-semibold" id="modal-title">Nutrition Target Details ({dateString})</h2>
				<button on:click={closeModal} class="text-gray-500 hover:text-gray-700 text-2xl font-bold">&times;</button>
			</div>

			<!-- Targets List -->
			{#if calculatedTargets.length === 0}
				<p>No nutrition targets have been defined yet. Go to Settings to add some.</p>
			{:else}
				<div class="space-y-4">
					{#each calculatedTargets as target (target.id)}
						<div class="border-b pb-3">
							<div class="flex justify-between items-center mb-1">
								<span class="font-medium">{target.displayLabel}</span>
                                {#if target.calculationError}
                                    <span class="text-xs text-red-600" title={target.calculationError}>Error</span>
                                {:else if target.actualValue !== null}
								    <span class="text-sm text-gray-700">
									    Actual: {Math.round(target.actualValue)} {target.displayUnit}
								    </span>
                                {:else}
                                     <span class="text-xs text-gray-500">N/A</span>
                                {/if}
							</div>
							<div class="text-xs text-gray-500 mb-2">
								Target: {target.min_value ?? '-'} to {target.max_value ?? '-'} {target.displayUnit}
							</div>
                            {#if target.calculationError}
                                <div class="h-4 bg-gray-300 rounded flex items-center justify-center">
                                    <span class="text-xs text-gray-600">Cannot display bar due to error</span>
                                </div>
                            {:else}
							    <TargetProgressBar
								    minValue={target.min_value}
								    maxValue={target.max_value}
								    actualValue={target.actualValue ?? 0}
								    unit={target.displayUnit}
                                    displayMin={target.displayMin}
                                    displayMax={target.displayMax}
							    />
                            {/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Close Button Footer -->
			<div class="mt-6 text-right">
				<button on:click={closeModal} class="px-4 py-2 bg-gray-300 hover:bg-gray-400 rounded">
					Close
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Optional: Add styles for modal transitions if desired */
</style>

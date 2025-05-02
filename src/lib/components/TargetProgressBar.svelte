<script lang="ts">
	export let minValue: number | null = null;
	export let maxValue: number | null = null;
	export let actualValue: number;
	export let unit: string; // 'g', 'kcal', or '%'
	export let displayMin: number; // Added prop for calculated display minimum
	export let displayMax: number; // Added prop for calculated display maximum

	// --- Constants for Visualization ---
	const BAR_HEIGHT = 'h-4'; // Tailwind height class
	const INDICATOR_WIDTH = 'w-1'; // Tailwind width class
	const INDICATOR_COLOR = 'bg-black';
	const GREEN_COLOR = 'bg-green-300';
	const RED_COLOR = 'bg-red-300';
	const GRAY_COLOR = 'bg-gray-200'; // For areas outside defined range

	// --- Calculation Logic ---
	// Now uses passed-in displayMin/displayMax
	$: ({ positionPercent, barSegments } = calculateVisualization(minValue, maxValue, actualValue, displayMin, displayMax));

	interface BarSegment {
		color: string;
		widthPercent: number;
	}

	// Updated function signature to accept displayMin/Max
	function calculateVisualization(
        min: number | null,
        max: number | null,
        actual: number,
        dispMin: number, // Use passed-in display min
        dispMax: number  // Use passed-in display max
    ): { positionPercent: number; barSegments: BarSegment[] } {
		let positionPercent = 50; // Default position if calculation fails
		let barSegments: BarSegment[] = [{ color: GRAY_COLOR, widthPercent: 100 }]; // Default bar

		if (actual === null || actual === undefined || isNaN(actual)) {
			// Handle cases where actual value is invalid
			return { positionPercent: 0, barSegments: [{ color: GRAY_COLOR, widthPercent: 100 }] };
		}

        // Use the provided display range
        const range = dispMax - dispMin;

		if (range <= 0) {
             // Avoid division by zero if range is invalid (should be caught in modal, but safety check)
             console.warn("TargetProgressBar received invalid display range:", dispMin, dispMax);
             return { positionPercent: 50, barSegments: [{ color: GRAY_COLOR, widthPercent: 100 }] };
        }

		// Calculate indicator position using the provided display range
		positionPercent = Math.max(0, Math.min(100, ((actual - dispMin) / range) * 100));

		// Calculate bar segments using the provided display range
		barSegments = [];
		let currentPos = 0;

		const addSegment = (value: number | null, color: string) => {
			if (value === null) return 0; // Skip if boundary is null
            // Calculate segment boundary position based on display range
			const targetPercent = Math.max(0, Math.min(100, ((value - dispMin) / range) * 100));
			const width = targetPercent - currentPos;
			if (width > 0.01) { // Use small threshold for floating point checks
				barSegments.push({ color: color, widthPercent: width });
			}
            currentPos = targetPercent; // This should be inside the function
			return width; // This should be inside the function
		}; // Correct placement of the closing brace

        // Determine colors based on target type
        if (min !== null && max !== null) { // Min and Max defined
            addSegment(min, RED_COLOR);       // Segment below min (Red)
            addSegment(max, GREEN_COLOR);     // Segment between min and max (Green)
            // Remaining segment above max (Red)
            const remainingWidth = 100 - currentPos;
            if (remainingWidth > 0) {
                 barSegments.push({ color: RED_COLOR, widthPercent: remainingWidth });
            }
        } else if (min !== null) { // Only Min defined
            addSegment(min, RED_COLOR);       // Segment below min (Red)
             // Remaining segment above min (Green)
            const remainingWidth = 100 - currentPos;
             if (remainingWidth > 0) {
                 barSegments.push({ color: GREEN_COLOR, widthPercent: remainingWidth });
            }
        } else if (max !== null) { // Only Max defined
            addSegment(max, GREEN_COLOR);     // Segment below max (Green)
             // Remaining segment above max (Red)
            const remainingWidth = 100 - currentPos;
             if (remainingWidth > 0) {
                 barSegments.push({ color: RED_COLOR, widthPercent: remainingWidth });
            }
        } else { // No target defined
             barSegments.push({ color: GRAY_COLOR, widthPercent: 100 });
        }


        // Ensure segments fill 100% if calculations were slightly off
        const totalWidth = barSegments.reduce((sum, seg) => sum + seg.widthPercent, 0);
        if (totalWidth < 99.9 && barSegments.length > 0) { // Allow for floating point inaccuracies
             barSegments[barSegments.length - 1].widthPercent += (100 - totalWidth);
        } else if (totalWidth > 100.1 && barSegments.length > 0) {
             // If over, trim the last segment
             barSegments[barSegments.length - 1].widthPercent -= (totalWidth - 100);
        }


		return { positionPercent, barSegments };
	}

    function formatDisplayValue(value: number): string {
        // Show one decimal unless it's a large number (e.g., > 1000) or very small
        if (Math.abs(value) > 1000 || (Math.abs(value) < 1 && value !== 0)) {
            return value.toFixed(0);
        }
        return value.toFixed(1);
    }

</script>

<!-- Container for bar and labels -->
<div class="w-full">
    <!-- Only render if actualValue is valid -->
    {#if actualValue !== null && actualValue !== undefined && !isNaN(actualValue)}
        <div class="relative w-full {BAR_HEIGHT} flex overflow-hidden rounded">
            <!-- Background Segments -->
            {#each barSegments as segment}
                <div class="{segment.color}" style="width: {segment.widthPercent}%;"></div>
            {/each}

            <!-- Indicator Line -->
            <div
                class="absolute top-0 bottom-0 {INDICATOR_WIDTH} {INDICATOR_COLOR} -ml-0.5"
                style="left: {positionPercent}%;"
                title={`Actual: ${actualValue.toFixed(1)}${unit === '%' ? '%' : ' ' + unit}\nTarget: ${minValue ?? 'N/A'} - ${maxValue ?? 'N/A'}${unit === '%' ? '%' : ' ' + unit}`}>
            </div>
        </div>
        <!-- Display Range Labels -->
        <div class="flex justify-between text-xs text-gray-500 mt-0.5 px-0.5">
            <span>{formatDisplayValue(displayMin)}{unit === '%' ? '%' : ''}</span>
            <span>{formatDisplayValue(displayMax)}{unit === '%' ? '%' : ''}</span>
        </div>
    {:else}
         <!-- Optional: Render placeholder or nothing if actualValue is invalid -->
         <div class="relative w-full {BAR_HEIGHT} {GRAY_COLOR} rounded" title="Actual value not available">
             <div class="flex justify-between text-xs text-gray-500 mt-0.5 px-0.5">
                 <span>N/A</span>
                 <span>N/A</span>
             </div>
         </div>
    {/if}
</div>

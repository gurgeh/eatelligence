<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<header class="bg-gray-100 shadow-sm">
	<nav class="container mx-auto px-4 py-2 flex justify-between items-center max-w-5xl">
		<a href="/" class="text-lg font-semibold text-indigo-600 hover:text-indigo-800">Eatelligence</a>
		<div class="space-x-4">
			<a href="/" class="text-gray-700 hover:text-indigo-600">Log Meal</a>
			<a href="/food-items" class="text-gray-700 hover:text-indigo-600">Manage Items</a>
			<a href="/settings/targets" class="text-gray-700 hover:text-indigo-600">Targets</a>
			<!-- Add other links here later if needed -->
		</div>
	</nav>
</header>

<main>
	{@render children()}
</main>

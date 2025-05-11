import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit'; // Changed import

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({ // Changed to SvelteKitPWA
			// registerType: 'autoUpdate', // Default is 'prompt' for SvelteKitPWA, let's see
			includeAssets: ['favicon.png'], // Include your static assets here
			manifest: {
				name: 'Eatelligence',
				short_name: 'Eatelligence',
				description: 'Personal Nutrition Tracker',
				theme_color: '#ffffff', // Adjust theme color as needed
				background_color: '#ffffff', // Added
				start_url: '/', // Added
				scope: '/', // Added
				display: 'standalone', // Added
				icons: [
					{
						src: 'icon-192x192.png', // Use your actual icon path
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: 'icon-512x512.png', // Use a larger icon if available
						sizes: '512x512',
						type: 'image/png'
					}
				]
			}
			// devOptions are usually not needed with SvelteKitPWA as it handles dev/build modes
		})
	]
});

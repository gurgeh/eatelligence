import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		VitePWA({
			registerType: 'autoUpdate',
			includeAssets: ['favicon.png'], // Include your static assets here
			manifest: {
				name: 'Eatelligence',
				short_name: 'Eatelligence',
				description: 'Personal Nutrition Tracker',
				theme_color: '#ffffff', // Adjust theme color as needed
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
		})
	]
});

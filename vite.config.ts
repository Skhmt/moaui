import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		svelte(),
		// VitePWA({
		// 	registerType: 'autoUpdate',
		// })
	],
})

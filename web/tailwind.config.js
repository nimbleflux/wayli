/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	darkMode: 'class',
	theme: {
		extend: {
			colors: {
				primary: {
					DEFAULT: 'rgb(34, 51, 95)',
					dark: '#60a5fa' // blue-400 equivalent for dark mode
				}
			}
		}
	},
	plugins: []
};

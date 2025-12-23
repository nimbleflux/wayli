import adapter from '@sveltejs/adapter-static';

const config = {
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: false
		}),
		csrf: {
			// Add your production domains here when deploying
			// Example: trustedOrigins: ['https://yourdomain.com', 'https://www.yourdomain.com']
			trustedOrigins: process.env.PUBLIC_TRUSTED_ORIGINS?.split(',') || []
		}
	}
};

export default config;

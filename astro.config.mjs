import { defineConfig } from 'astro/config';
export default defineConfig({ site: process.env.DEPLOY_PRIME_URL || process.env.URL || 'https://example.invalid', output: 'static', trailingSlash: 'always', devToolbar: { enabled: false } });

import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Tests run in plain Node (no SvelteKit runtime), so the two SvelteKit
// virtual imports our server code uses are aliased to real modules:
// $lib to the source directory and $env/dynamic/private to a process.env
// stub. The database is an in-memory SQLite per worker (see tests/setup.ts).
export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(import.meta.dirname, 'src/lib'),
			'$env/dynamic/private': path.resolve(import.meta.dirname, 'src/tests/env-stub.ts'),
			'$env/dynamic/public': path.resolve(import.meta.dirname, 'src/tests/env-stub.ts')
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		setupFiles: ['./src/tests/setup.ts']
	}
});

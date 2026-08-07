import { connect } from 'itty-sockets';
import { env } from '$env/dynamic/public';

/**
 * Best-effort broadcast that server data changed. Viewers subscribed to the
 * channel (see +layout.svelte) react by re-fetching through their own
 * authenticated session.
 *
 * Deliberately content-free: itty-sockets channels are public pub/sub, so the
 * message never carries rota data — only the hint that something changed.
 * No channel configured (e.g. tests/CI) means no-op; realtime is an
 * enhancement and must never fail a save.
 */
export function broadcastChange(topic: 'rota' | 'users'): void {
	const channel = env.PUBLIC_REALTIME_CHANNEL;
	if (!channel) return;
	try {
		// push() sends and disconnects — no persistent connection to manage.
		connect(channel).push({ event: 'data-changed', topic });
	} catch {
		// Never let a realtime hiccup break the request.
	}
}

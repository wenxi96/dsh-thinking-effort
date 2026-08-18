/**
 * Thinking-effort settings section plugin, node half. Pure UI plugin: the
 * empty apply exists so the plugin appears in the host cordis.yml / Loader;
 * the browser half ships via exports["./client"], discovered through the
 * package.json `dsh.client` declaration. The section reads and writes the
 * `llm-pi-ai` settings namespace through the browser settings wire face
 * (`connection.api.settings`), so no host-side RPC is needed.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}

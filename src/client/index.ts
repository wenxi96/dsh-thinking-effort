/**
 * Thinking-effort settings section, browser half.
 *
 * Registers one row in the Settings "settings.section" slot — the same
 * surface ui-settings-general renders — under the id `thinking-effort` (the
 * shell's nav icon table already maps that id to the think glyph). The
 * section edits each configured llm-pi-ai model's `reasoningEfforts` through
 * the browser settings wire face (`connection.api.settings`), so a refresh
 * needs neither a host RPC layer nor any dynamic-plugin runtime.
 */

import { createElement } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { EffortSection } from './EffortSection.tsx'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'connection']

/** Stable section id the shell nav icon table also knows. */
export const SETTINGS_SECTION_ID = 'thinking-effort'

/**
 * Mount the thinking-effort settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SETTINGS_SECTION_ID,
    order: 12,
    label: () => '思考程度',
  }, () => createElement(EffortSection, { api })))
}
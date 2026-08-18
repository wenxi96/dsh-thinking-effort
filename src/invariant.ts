/**
 * Package-owned invariant companion for `@chengwd96/dsh-thinking-effort`.
 * @module @chengwd96/dsh-thinking-effort/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@chengwd96/dsh-thinking-effort'

/** Cordis companion plugin name. */
export const name = 'dsh-thinking-effort-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the section's slot registration and its settings
 * reads/writes are exercised on the real surface by the package.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

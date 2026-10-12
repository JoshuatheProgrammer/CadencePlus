/** Cadence+ self-update: releases tagged "plus-v<version>" (see @cadence/release). */
import { createSelfUpdater } from '@cadence/release/updater'

declare const __RELEASE__: { owner: string; repo: string }

export const updater = createSelfUpdater(__RELEASE__, 'plus-v')

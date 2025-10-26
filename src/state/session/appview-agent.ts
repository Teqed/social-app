import {
  type AtpSessionData,
  type AtpSessionEvent,
  BskyAgent,
} from '@atproto/api'

import {BSKY_SERVICE, PBLLC_BLUESKY_PROXY_HEADER} from '#/lib/constants'
import {logger} from '#/logger'
import {emitNetworkConfirmed, emitNetworkLost} from '../events'
import {sessionAccountToSession} from './agent'
import {addSessionErrorLog} from './logging'
import {type SessionAccount} from './types'

/**
 * Specialized agent for appview operations that always uses the PBLLC proxy
 */
export class AppviewBskyAgent extends BskyAgent {
  persistSessionHandler: ((event: AtpSessionEvent) => void) | undefined =
    undefined

  constructor() {
    super({
      service: BSKY_SERVICE,
      async fetch(...args) {
        let success = false
        try {
          const result = await globalThis.fetch(...args)
          success = true
          return result
        } catch (e) {
          success = false
          throw e
        } finally {
          if (success) {
            emitNetworkConfirmed()
          } else {
            emitNetworkLost()
          }
        }
      },
      persistSession: (event: AtpSessionEvent) => {
        if (this.persistSessionHandler) {
          this.persistSessionHandler(event)
        }
      },
    })

    // Always configure with PBLLC proxy
    this.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
  }

  /**
   * Set up the appview agent with the current user's session
   */
  initializeWithAccount(account: SessionAccount) {
    try {
      const session: AtpSessionData = sessionAccountToSession(account)
      this.sessionManager.session = session

      if (account.pdsUrl) {
        this.sessionManager.pdsUrl = new URL(account.pdsUrl)
      }

      this.persistSessionHandler = event => {
        if (event !== 'create' && event !== 'update') {
          addSessionErrorLog(account.did, event)
        }
      }

      return true
    } catch (error) {
      logger.error('Failed to initialize appview agent', {error})
      return false
    }
  }

  /**
   * Clear the current session data
   */
  clearSession() {
    this.sessionManager.session = undefined
    this.persistSessionHandler = undefined
  }
}

// Singleton instance for appview operations
const _appviewAgent = new AppviewBskyAgent()

/**
 * Returns the appview agent instance
 */
export function getBskyAppviewAgent(): AppviewBskyAgent {
  return _appviewAgent
}

// No replacement needed, content already handled in previous edit

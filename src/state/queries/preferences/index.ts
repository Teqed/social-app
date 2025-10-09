import {useCallback} from 'react'
import {
  type AppBskyActorDefs,
  type BskyFeedViewPreference,
  type LabelPreference,
} from '@atproto/api'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'

import {
  BLUESKY_PROXY_HEADER,
  PBLLC_BLUESKY_PROXY_HEADER,
  PROD_DEFAULT_FEED,
} from '#/lib/constants'
import {replaceEqualDeep} from '#/lib/functions'
import {getAge} from '#/lib/strings/time'
import {logger} from '#/logger'
import {useAgeAssuranceContext} from '#/state/ageAssurance'
import {makeAgeRestrictedModerationPrefs} from '#/state/ageAssurance/const'
import {STALE} from '#/state/queries'
import {
  DEFAULT_HOME_FEED_PREFS,
  DEFAULT_LOGGED_OUT_PREFERENCES,
  DEFAULT_THREAD_VIEW_PREFS,
} from '#/state/queries/preferences/const'
import {
  type ThreadViewPreferences,
  type UsePreferencesQueryResponse,
} from '#/state/queries/preferences/types'
import {useAgent} from '#/state/session'
import {saveLabelers} from '#/state/session/agent-config'

export * from '#/state/queries/preferences/const'
export * from '#/state/queries/preferences/moderation'
export * from '#/state/queries/preferences/types'

const preferencesQueryKeyRoot = 'getPreferences'
export const preferencesQueryKey = [preferencesQueryKeyRoot]

export function usePreferencesQuery() {
  const agent = useAgent()
  const {isAgeRestricted} = useAgeAssuranceContext()

  return useQuery({
    staleTime: STALE.SECONDS.FIFTEEN,
    structuralSharing: replaceEqualDeep,
    refetchOnWindowFocus: true,
    queryKey: preferencesQueryKey,
    queryFn: async () => {
      if (!agent.did) {
        return DEFAULT_LOGGED_OUT_PREFERENCES
      } else {
        agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
        const res = await agent.getPreferences()
        agent.configureProxy(BLUESKY_PROXY_HEADER.get())

        // save to local storage to ensure there are labels on initial requests
        saveLabelers(
          agent.did,
          res.moderationPrefs.labelers.map(l => l.did),
        )

        const preferences: UsePreferencesQueryResponse = {
          ...res,
          savedFeeds: res.savedFeeds.filter(f => f.type !== 'unknown'),
          /**
           * Special preference, only used for following feed, previously
           * called `home`
           */
          feedViewPrefs: {
            ...DEFAULT_HOME_FEED_PREFS,
            ...(res.feedViewPrefs.home || {}),
          },
          threadViewPrefs: {
            ...DEFAULT_THREAD_VIEW_PREFS,
            ...(res.threadViewPrefs ?? {}),
          },
          userAge: res.birthDate ? getAge(res.birthDate) : undefined,
        }
        return preferences
      }
    },
    select: useCallback(
      (data: UsePreferencesQueryResponse) => {
        const isUnderage = (data.userAge || 0) < 18
        if (isUnderage || isAgeRestricted) {
          data = {
            ...data,
            moderationPrefs: makeAgeRestrictedModerationPrefs(
              data.moderationPrefs,
            ),
          }
        }
        return data
      },
      [isAgeRestricted],
    ),
  })
}

export function useClearPreferencesMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async () => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.app.bsky.actor.putPreferences({preferences: []})
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function usePreferencesSetContentLabelMutation() {
  const agent = useAgent()
  const queryClient = useQueryClient()

  return useMutation<
    void,
    unknown,
    {label: string; visibility: LabelPreference; labelerDid: string | undefined}
  >({
    mutationFn: async ({label, visibility, labelerDid}) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.setContentLabelPref(label, visibility, labelerDid)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      logger.metric(
        'moderation:changeLabelPreference',
        {preference: visibility},
        {statsig: true},
      )
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetContentLabelMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async ({
      label,
      visibility,
      labelerDid,
    }: {
      label: string
      visibility: LabelPreference
      labelerDid?: string
    }) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.setContentLabelPref(label, visibility, labelerDid)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function usePreferencesSetAdultContentMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<void, unknown, {enabled: boolean}>({
    mutationFn: async ({enabled}) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.setAdultContentEnabled(enabled)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function usePreferencesSetBirthDateMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<void, unknown, {birthDate: Date}>({
    mutationFn: async ({birthDate}: {birthDate: Date}) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.setPersonalDetails({birthDate: birthDate.toISOString()})
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetFeedViewPreferencesMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<void, unknown, Partial<BskyFeedViewPreference>>({
    mutationFn: async prefs => {
      /*
       * special handling here, merged into `feedViewPrefs` above, since
       * following was previously called `home`
       */
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.setFeedViewPrefs('home', prefs)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetThreadViewPreferencesMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<void, unknown, Partial<ThreadViewPreferences>>({
    mutationFn: async prefs => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.setThreadViewPrefs(prefs)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useOverwriteSavedFeedsMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<void, unknown, AppBskyActorDefs.SavedFeed[]>({
    mutationFn: async savedFeeds => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.overwriteSavedFeeds(savedFeeds)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useAddSavedFeedsMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<
    void,
    unknown,
    Pick<AppBskyActorDefs.SavedFeed, 'type' | 'value' | 'pinned'>[]
  >({
    mutationFn: async savedFeeds => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.addSavedFeeds(savedFeeds)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useRemoveFeedMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<void, unknown, Pick<AppBskyActorDefs.SavedFeed, 'id'>>({
    mutationFn: async savedFeed => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.removeSavedFeeds([savedFeed.id])
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useReplaceForYouWithDiscoverFeedMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async ({
      forYouFeedConfig,
      discoverFeedConfig,
    }: {
      forYouFeedConfig: AppBskyActorDefs.SavedFeed | undefined
      discoverFeedConfig: AppBskyActorDefs.SavedFeed | undefined
    }) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      if (forYouFeedConfig) {
        await agent.removeSavedFeeds([forYouFeedConfig.id])
      }
      if (!discoverFeedConfig) {
        await agent.addSavedFeeds([
          {
            type: 'feed',
            value: PROD_DEFAULT_FEED('Discover'),
            pinned: true,
          },
        ])
      } else {
        await agent.updateSavedFeeds([
          {
            ...discoverFeedConfig,
            pinned: true,
          },
        ])
      }
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useUpdateSavedFeedsMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<void, unknown, AppBskyActorDefs.SavedFeed[]>({
    mutationFn: async feeds => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.updateSavedFeeds(feeds)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())

      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useUpsertMutedWordsMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async (mutedWords: AppBskyActorDefs.MutedWord[]) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.upsertMutedWords(mutedWords)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useUpdateMutedWordMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async (mutedWord: AppBskyActorDefs.MutedWord) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.updateMutedWord(mutedWord)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useRemoveMutedWordMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async (mutedWord: AppBskyActorDefs.MutedWord) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.removeMutedWord(mutedWord)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useRemoveMutedWordsMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async (mutedWords: AppBskyActorDefs.MutedWord[]) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.removeMutedWords(mutedWords)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useQueueNudgesMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async (nudges: string | string[]) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.bskyAppQueueNudges(nudges)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useDismissNudgesMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async (nudges: string | string[]) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.bskyAppDismissNudges(nudges)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetActiveProgressGuideMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation({
    mutationFn: async (
      guide: AppBskyActorDefs.BskyAppProgressGuide | undefined,
    ) => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.bskyAppSetActiveProgressGuide(guide)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetVerificationPrefsMutation() {
  const queryClient = useQueryClient()
  const agent = useAgent()

  return useMutation<void, unknown, AppBskyActorDefs.VerificationPrefs>({
    mutationFn: async prefs => {
      agent.configureProxy(PBLLC_BLUESKY_PROXY_HEADER.get())
      await agent.setVerificationPrefs(prefs)
      agent.configureProxy(BLUESKY_PROXY_HEADER.get())
      if (prefs.hideBadges) {
        logger.metric('verification:settings:hideBadges', {}, {statsig: true})
      } else {
        logger.metric('verification:settings:unHideBadges', {}, {statsig: true})
      }
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

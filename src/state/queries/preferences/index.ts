import {useCallback} from 'react'
import {
  type AppBskyActorDefs,
  type BskyFeedViewPreference,
  type LabelPreference,
} from '@atproto/api'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'

import {PROD_DEFAULT_FEED} from '#/lib/constants'
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
import {getBskyAppviewAgent} from '#/state/session/appview-agent'

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
        const appviewAgent = getBskyAppviewAgent()
        const res = await appviewAgent.getPreferences()

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

  return useMutation({
    mutationFn: async () => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.app.bsky.actor.putPreferences({preferences: []})
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function usePreferencesSetContentLabelMutation() {
  const queryClient = useQueryClient()

  return useMutation<
    void,
    unknown,
    {label: string; visibility: LabelPreference; labelerDid: string | undefined}
  >({
    mutationFn: async ({label, visibility, labelerDid}) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.setContentLabelPref(label, visibility, labelerDid)
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
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.setContentLabelPref(label, visibility, labelerDid)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function usePreferencesSetAdultContentMutation() {
  const queryClient = useQueryClient()

  return useMutation<void, unknown, {enabled: boolean}>({
    mutationFn: async ({enabled}) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.setAdultContentEnabled(enabled)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function usePreferencesSetBirthDateMutation() {
  const queryClient = useQueryClient()

  return useMutation<void, unknown, {birthDate: Date}>({
    mutationFn: async ({birthDate}: {birthDate: Date}) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.setPersonalDetails({
        birthDate: birthDate.toISOString(),
      })
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetFeedViewPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<void, unknown, Partial<BskyFeedViewPreference>>({
    mutationFn: async prefs => {
      /*
       * special handling here, merged into `feedViewPrefs` above, since
       * following was previously called `home`
       */
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.setFeedViewPrefs('home', prefs)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetThreadViewPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<void, unknown, Partial<ThreadViewPreferences>>({
    mutationFn: async prefs => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.setThreadViewPrefs(prefs)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useOverwriteSavedFeedsMutation() {
  const queryClient = useQueryClient()

  return useMutation<void, unknown, AppBskyActorDefs.SavedFeed[]>({
    mutationFn: async savedFeeds => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.overwriteSavedFeeds(savedFeeds)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useAddSavedFeedsMutation() {
  const queryClient = useQueryClient()

  return useMutation<
    void,
    unknown,
    Pick<AppBskyActorDefs.SavedFeed, 'type' | 'value' | 'pinned'>[]
  >({
    mutationFn: async savedFeeds => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.addSavedFeeds(savedFeeds)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useRemoveFeedMutation() {
  const queryClient = useQueryClient()

  return useMutation<void, unknown, Pick<AppBskyActorDefs.SavedFeed, 'id'>>({
    mutationFn: async savedFeed => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.removeSavedFeeds([savedFeed.id])
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useReplaceForYouWithDiscoverFeedMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      forYouFeedConfig,
      discoverFeedConfig,
    }: {
      forYouFeedConfig: AppBskyActorDefs.SavedFeed | undefined
      discoverFeedConfig: AppBskyActorDefs.SavedFeed | undefined
    }) => {
      const appviewAgent = getBskyAppviewAgent()
      if (forYouFeedConfig) {
        await appviewAgent.removeSavedFeeds([forYouFeedConfig.id])
      }
      if (!discoverFeedConfig) {
        await appviewAgent.addSavedFeeds([
          {
            type: 'feed',
            value: PROD_DEFAULT_FEED('Discover'),
            pinned: true,
          },
        ])
      } else {
        await appviewAgent.updateSavedFeeds([
          {
            ...discoverFeedConfig,
            pinned: true,
          },
        ])
      }
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useUpdateSavedFeedsMutation() {
  const queryClient = useQueryClient()

  return useMutation<void, unknown, AppBskyActorDefs.SavedFeed[]>({
    mutationFn: async feeds => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.updateSavedFeeds(feeds)

      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useUpsertMutedWordsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (mutedWords: AppBskyActorDefs.MutedWord[]) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.upsertMutedWords(mutedWords)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useUpdateMutedWordMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (mutedWord: AppBskyActorDefs.MutedWord) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.updateMutedWord(mutedWord)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useRemoveMutedWordMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (mutedWord: AppBskyActorDefs.MutedWord) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.removeMutedWord(mutedWord)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useRemoveMutedWordsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (mutedWords: AppBskyActorDefs.MutedWord[]) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.removeMutedWords(mutedWords)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useQueueNudgesMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (nudges: string | string[]) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.bskyAppQueueNudges(nudges)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useDismissNudgesMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (nudges: string | string[]) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.bskyAppDismissNudges(nudges)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetActiveProgressGuideMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      guide: AppBskyActorDefs.BskyAppProgressGuide | undefined,
    ) => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.bskyAppSetActiveProgressGuide(guide)
      // triggers a refetch
      await queryClient.invalidateQueries({
        queryKey: preferencesQueryKey,
      })
    },
  })
}

export function useSetVerificationPrefsMutation() {
  const queryClient = useQueryClient()

  return useMutation<void, unknown, AppBskyActorDefs.VerificationPrefs>({
    mutationFn: async prefs => {
      const appviewAgent = getBskyAppviewAgent()
      await appviewAgent.setVerificationPrefs(prefs)
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

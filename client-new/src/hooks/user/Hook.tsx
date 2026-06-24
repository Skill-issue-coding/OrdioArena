/**
 * @file Hook.tsx (hooks/user/Hook.tsx)
 * Global React context that owns the local user profile.
 *
 * Architecture:
 * - Subscribes to the websocket transport for server-assigned user data.
 * - Applies local storage preferences (username/background) on connect.
 * - Exposes a typed update function that emits update_user events.
 *
 * Usage:
 * ```tsx
 * const { user, updateUser } = useUserContext();
 * updateUser({ username: "Player1" });
 * ```
 */

import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import axios from "axios"
import { ToastError, ToastSucess } from "@/lib/ToastFunctions"
import { tryCatch } from "@/lib/try-catch"
import { useWebsocketContext } from "@/hooks/websocket/Hook"
import type { LocalStorageProfile, User } from "@/hooks/user/types"
import type { WSReceivedPayloadMap } from "@/hooks/websocket/types"

export interface UserContextProps {
  /**
   * The current player's profile as assigned/confirmed by the server.
   * Null until the connected_to_hub event is received.
   */
  user: User | null

  /**
   * Optimistically update the local user profile and emit an update_user
   * event to the server. The server will propagate the change to all lobby
   * members via sync_gamestate.
   */
  updateUser: (updates: Partial<User>) => Promise<void>
}

export const UserContext = createContext<UserContextProps | null>(null)

/**
 * Access the current user state and updater.
 *
 * Usage:
 * ```tsx
 * const { user, updateUser } = useUserContext();
 * ```
 */
export function useUserContext() {
  const context = useContext(UserContext)
  if (!context) throw new Error("useUserContext must be used within a UserProvider")
  return context
}

/**
 * Load the cached profile from localStorage (if present).
 *
 * Usage:
 * ```ts
 * const profile = GetLocalStorageProfile();
 * ```
 */
export const GetLocalStorageProfile = (): LocalStorageProfile | undefined => {
  const stored = typeof window !== "undefined" ? localStorage.getItem("profile") : null
  if (!stored) return undefined
  try {
    return JSON.parse(stored) as LocalStorageProfile
  } catch (e) {
    console.error("Could not load profile: ", e)
    return undefined
  }
}

/** Persist the profile to localStorage in the browser. */
const SaveLocalStorageProfile = (profile: LocalStorageProfile) => {
  if (typeof window === "undefined") return
  localStorage.setItem("profile", JSON.stringify(profile))
}

/**
 * Request a server-generated username for a user id.
 *
 * Usage:
 * ```ts
 * const username = await GetNewUsername(userId);
 * ```
 */
export async function GetNewUsername(userId: string): Promise<string> {
  const url = import.meta.env.VITE_PUBLIC_BACKEND_PATH ? `${import.meta.env.VITE_PUBLIC_BACKEND_PATH}/game/username` : `http://localhost:8080/game/username`
  const { data, error } = await tryCatch(
    axios.post<{ username: string; error?: string }>(url, {
      user_id: userId,
    })
  )

  if (error) throw error
  if (!data.data.username) throw new Error(data.data.error ?? "Could not fetch username")

  return data.data.username
}

/**
 * Provides the user context to all child components.
 *
 * Usage:
 * ```tsx
 * <UserProvider>
 *   <App />
 * </UserProvider>
 * ```
 */
export function UserProvider({ children }: { children: ReactNode }) {
  const { sendEvent, subscribe } = useWebsocketContext()
  const [user, setUser] = useState<WSReceivedPayloadMap["connected_to_hub"]["user"] | null>(null)

  // On connected_to_hub, merge the server-assigned profile with any saved localStorage preferences.
  useEffect(() => {
    const unsubscribe = subscribe("connected_to_hub", (payload) => {
      const serverUser = payload.user as User
      const profile = GetLocalStorageProfile()

      if (profile) {
        // Merge local storage preferences with server-assigned user data
        const mergeUser = {
          ...serverUser,
          username: profile.username ?? serverUser.username,
          background: profile.background ?? serverUser.background,
        }

        setUser(mergeUser)

        // Tell the server about our locally stored username/background
        sendEvent("update_user", {
          username: mergeUser.username,
          background: mergeUser.background,
        })
      } else {
        setUser(serverUser)
      }

      ToastSucess("Välkommen till OrdioArena!")
    })

    // Cleanup the listener when the provider unmounts
    return unsubscribe
  }, [subscribe, sendEvent])

  /**
   * updateUser applies a partial update to the local user state optimistically
   * and emits an update_user event to the server.
   */
  const updateUser = async (updates: Partial<Pick<User, "username" | "background">>) => {
    const currentUser = user
    if (!currentUser) return

    let nextUpdates = { ...updates }
    const trimmedUsername = updates.username?.trim()

    if (trimmedUsername === "") {
      try {
        const newUsername = await GetNewUsername(currentUser.user_id)
        nextUpdates = { ...nextUpdates, username: newUsername }
      } catch (error) {
        ToastError("Kunde inte skapa nytt anvandarnamn")
        return
      }
    }

    sendEvent("update_user", nextUpdates)

    setUser((prev) => {
      if (!prev) return null

      const existingProfile = GetLocalStorageProfile() || ({} as LocalStorageProfile)

      SaveLocalStorageProfile({
        ...existingProfile,
        username: nextUpdates.username ?? prev.username,
        background: nextUpdates.background ?? prev.background,
      })

      return { ...prev, ...nextUpdates }
    })
  }

  const value: UserContextProps = { user, updateUser }

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

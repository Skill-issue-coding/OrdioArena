import { LobbyContextProvider } from "@/hooks/lobbycontext";
import { NewGameContextProvider } from "@/hooks/newgamecontext";
import { ReactNode, Suspense } from "react";
import LobbyChat from "@/components/lobby/LobbyChat";

export default function LobbyContextLayoutWrapper({ children }: { children: ReactNode }) {
  return (
    <LobbyContextProvider>
      <NewGameContextProvider>
        {children}
      </NewGameContextProvider>
      <Suspense fallback={null}>
        <LobbyChat />
      </Suspense>
    </LobbyContextProvider>
  );
}

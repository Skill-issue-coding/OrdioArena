import { LobbyContextProvider } from "@/hooks/lobbycontext";
import { ReactNode } from "react";

export default function LobbyContextLayoutWrapper({ children }: { children: ReactNode }) {
  return <LobbyContextProvider>{children}</LobbyContextProvider>;
}

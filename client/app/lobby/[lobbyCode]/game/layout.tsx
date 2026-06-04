import { NewGameContextProvider } from "@/hooks/newgamecontext";
import { ReactNode } from "react";

export default function GameContextLayoutWrapper({ children }: { children: ReactNode }) {
  return <NewGameContextProvider>{children}</NewGameContextProvider>;
}

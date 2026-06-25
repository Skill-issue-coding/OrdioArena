import { useTheme } from "@/hooks/theme-provider"
import { Toaster } from "sonner"

export default function ThemedToaster() {
  const { theme } = useTheme()

  return <Toaster position="top-right" theme={theme === "dark" ? "dark" : "light"} />
}

"use client";

import { TurnkeyProvider } from "@turnkey/react-wallet-kit";
import { AuthProvider } from "@/contexts/AuthContext";

const turnkeyConfig = {
  organizationId: process.env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID!,
  authProxyConfigId: process.env.NEXT_PUBLIC_TURNKEY_AUTH_PROXY_CONFIG_ID!,
  ui: {
    darkMode: true,
    borderRadius: "16px",
    backgroundBlur: "12px",
    colors: {
      dark: {
        // Sakura / Suwappu brand palette
        primary: "#C44569",
        primaryText: "#FFFFFF",
        button: "#C44569",
        modalBackground: "#1A1625",
        modalText: "#F8F4FB",
        iconBackground: "#2D2640",
        iconText: "#FFB7C5",
        success: "#A8E6A3",
        successText: "#1A1625",
        danger: "#F8A0A0",
        dangerText: "#1A1625",
      },
      light: {
        primary: "#C44569",
        primaryText: "#FFFFFF",
        button: "#C44569",
        modalBackground: "#FFFBFC",
        modalText: "#2C3E50",
        iconBackground: "#FFD1DC",
        iconText: "#6C3483",
        success: "#A8E6A3",
        successText: "#2C3E50",
        danger: "#F8A0A0",
        dangerText: "#2C3E50",
      },
    },
  },
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TurnkeyProvider
      config={turnkeyConfig}
      callbacks={{
        onError: (error) => {
          console.error("[Turnkey] Error:", error);
        },
      }}
    >
      <AuthProvider>{children}</AuthProvider>
    </TurnkeyProvider>
  );
}

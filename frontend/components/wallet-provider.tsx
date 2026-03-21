"use client";

import { PropsWithChildren, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount } from "wagmi";
import { clearWalletAddress, saveWalletAddress } from "@/lib/api";
import { wagmiConfig } from "@/lib/wagmi";

function WalletAddressSync() {
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (isConnected && address) {
      try {
        saveWalletAddress(address);
      } catch {
        clearWalletAddress();
      }
      return;
    }

    clearWalletAddress();
  }, [address, isConnected]);

  return null;
}

export default function WalletProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <WalletAddressSync />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

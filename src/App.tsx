import { useCallback, useState } from "react";
import { CocoProvider } from "./hooks/useCoco";
import { destroyWalletRuntime } from "./coco/manager";
import { getUnlockedMnemonic, lockVault } from "./coco/vault";
import { WalletGate } from "./components/WalletGate";
import { WalletShell } from "./components/WalletShell";

export default function App() {
  const [mnemonic, setMnemonic] = useState<string | null>(() => getUnlockedMnemonic());

  const handleUnlock = useCallback((nextMnemonic: string) => {
    setMnemonic(nextMnemonic);
  }, []);

  const handleLock = useCallback(() => {
    lockVault();
    void destroyWalletRuntime();
    setMnemonic(null);
  }, []);

  const handleVaultReplaced = useCallback((nextMnemonic: string) => {
    setMnemonic(nextMnemonic);
  }, []);

  if (!mnemonic) {
    return <WalletGate onUnlock={handleUnlock} />;
  }

  return (
    <CocoProvider mnemonic={mnemonic}>
      <WalletShell
        currentMnemonic={mnemonic}
        onLock={handleLock}
        onVaultReplaced={handleVaultReplaced}
      />
    </CocoProvider>
  );
}

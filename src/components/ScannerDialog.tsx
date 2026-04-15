import { useEffect, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { ScanQrCode } from "lucide-react";
import { toErrorMessage } from "../lib/errors";

type ScannerDialogProps = {
  open: boolean;
  title: string;
  description: string;
  onDetected: (value: string) => void;
  onClose: () => void;
};

export function ScannerDialog({
  open,
  title,
  description,
  onDetected,
  onClose,
}: ScannerDialogProps) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card modal-card--scanner" role="dialog" aria-modal="true">
        <div className="section-header">
          <div>
            <p className="eyebrow">QR Scanner</p>
            <h2>{title}</h2>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="supporting-text">{description}</p>

        <div className="scanner-shell">
          <Scanner
            paused={!open}
            constraints={{ facingMode: "environment" }}
            onScan={(codes) => {
              const value = codes.find((code) => code.rawValue)?.rawValue;

              if (!value) {
                return;
              }

              setError(null);
              onDetected(value);
              onClose();
            }}
            onError={(nextError) => {
              setError(toErrorMessage(nextError));
            }}
          />

          <div className="scanner-overlay">
            <ScanQrCode className="scanner-overlay__icon" />
            <span>Camera access is required to scan.</span>
          </div>
        </div>

        {error ? <p className="status-banner status-error">{error}</p> : null}
      </div>
    </div>
  );
}

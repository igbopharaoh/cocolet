import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("@cashu/coco-core") ||
            id.includes("@cashu/coco-indexeddb") ||
            id.includes("@cashu/cashu-ts") ||
            id.includes("dexie")
          ) {
            return "coco-runtime";
          }

          if (
            id.includes("@yudiel/react-qr-scanner") ||
            id.includes("barcode-detector") ||
            id.includes("webrtc-adapter") ||
            id.includes("qrcode")
          ) {
            return "qr-tools";
          }

          if (id.includes("lucide-react")) {
            return "ui-vendor";
          }

          return undefined;
        },
      },
    },
  },
});

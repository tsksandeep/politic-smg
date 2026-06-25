import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host:true (0.0.0.0) so the dev server is reachable from outside the container; strictPort so
// the mapped port is stable; usePolling because Docker bind-mount FS events are unreliable on
// macOS/Windows; explicit hmr client port so the browser's websocket reaches the mapped port.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: { usePolling: true },
    hmr: { clientPort: 5173 },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});

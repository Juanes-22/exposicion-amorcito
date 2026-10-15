import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const SERVER_PORT = Number(process.env.PORT ?? 3001);

/**
 * En desarrollo, recarga la página cuando cambia el TMJ, `laboratorio.json` o el catálogo (SPECS 8.6).
 * Solo recarga: no importa ni transforma nada. Una sala ya iniciada no adopta el mapa editado; hace falta una sala o demo nueva.
 */
function reloadOnProjectChange(): Plugin {
  return {
    name: "laboratorio-project-reload",
    apply: "serve",
    configureServer(server) {
      const watched = (file: string) => {
        const f = resolve(file);
        const pub = resolve(server.config.root, "public");
        return (f.startsWith(resolve(pub, "maps")) && f.endsWith(".tmj")) || f === resolve(pub, "config/laboratorio.json") || f === resolve(pub, "assets/assets.json");
      };
      server.watcher.on("change", (file) => {
        if (watched(file)) server.ws.send({ type: "full-reload", path: "*" });
      });
    },
  };
}

export default defineConfig({
  // Absoluta por defecto: las rutas de entrada (`/sala/ABC123`) no pueden resolver recursos relativos al segmento de la sala (CT-16).
  // Si el despliegue vive bajo un prefijo, compilar con VITE_BASE=/prefijo/.
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), reloadOnProjectChange()],
  build: {
    outDir: "dist",
    // El código compilado no comparte carpeta con public/assets/ (assets.json y sus imágenes).
    assetsDir: "bundle",
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5173,
    // Hosts adicionales con los que se puede abrir el servidor de desarrollo (Vite rechaza los que no conoce): túnel de Cloudflare.
    allowedHosts: ["manually-gnu-vids-whats.trycloudflare.com"],
    proxy: {
      "/api": { target: `http://localhost:${SERVER_PORT}` },
      "/socket.io": { target: `http://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  test: {
    // Las pruebas de componentes declaran `// @vitest-environment jsdom` en su cabecera.
    include: ["shared/**/*.test.ts", "server/**/*.test.ts", "scripts/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
  },
});

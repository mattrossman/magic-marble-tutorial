import { defineConfig } from 'vite'
import reactRefresh from '@vitejs/plugin-react-refresh'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [reactRefresh()],
  root: 'src',
  base: '',
  publicDir: '../public',
  build: {
    outDir: '../dist'
  },
  esbuild: {
    jsxInject: "import React from 'react'",
  },
  server: {
    port: 1234,
    open: true,
  },
})

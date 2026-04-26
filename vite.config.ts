import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Use esbuild for minification (faster than terser, included with Vite)
    minify: 'esbuild',
    // Code splitting for better caching
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React ecosystem in one chunk
          if (id.includes('node_modules/react') || 
              id.includes('node_modules/react-dom') || 
              id.includes('node_modules/react-router-dom') ||
              id.includes('node_modules/scheduler')) {
            return 'react-vendor';
          }
          // Map libraries - large, should be separate
          if (id.includes('node_modules/maplibre-gl') ||
              id.includes('node_modules/react-map-gl') ||
              id.includes('node_modules/@protomaps')) {
            return 'map-vendor';
          }
          // Animation library
          if (id.includes('node_modules/framer-motion')) {
            return 'motion';
          }
          // Geo utilities - large library
          if (id.includes('node_modules/@turf')) {
            return 'geo-utils';
          }
          // State management
          if (id.includes('node_modules/zustand')) {
            return 'state';
          }
          // deck.gl visualization library
          if (id.includes('node_modules/@deck.gl') ||
              id.includes('node_modules/@luma.gl') ||
              id.includes('node_modules/@math.gl') ||
              id.includes('node_modules/@probe.gl') ||
              id.includes('node_modules/@loaders.gl')) {
            return 'deck-vendor';
          }
        },
      },
    },
    // Target modern browsers for smaller bundles
    target: 'es2020',
    // Increase chunk size warning limit (some libs are large)
    chunkSizeWarningLimit: 600,
  },
  // Remove console.log in production builds
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
  // Optimize dependency pre-bundling
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'maplibre-gl', 'zustand', '@deck.gl/core'],
    // Exclude large libs that are lazy loaded
    exclude: ['@turf/turf'],
  },
}))

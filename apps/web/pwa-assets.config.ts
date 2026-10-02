import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// One-off icon generation: `npx @vite-pwa/assets-generator` (outputs are committed in public/).
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.25, resizeOptions: { background: '#0b5f73' } },
    apple: { ...minimal2023Preset.apple, padding: 0.2, resizeOptions: { background: '#0b5f73' } },
  },
  images: ['public/favicon.svg'],
});

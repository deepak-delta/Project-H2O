// Tells the bundled "no internet" page where the app lives, so "Try again" reopens it.
import { writeFileSync } from 'node:fs';

const url = new URL(process.env.APP_URL ?? 'https://project-h2-o-ten.vercel.app').href;
writeFileSync(new URL('./www/app-url.js', import.meta.url), `window.APP_URL = ${JSON.stringify(url)};\n`);

import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { ink: '#172033', paper: '#f4f6fa', teal: '#0b8278', mist: '#e8f4f2' }, boxShadow: { card: '0 12px 38px rgba(23,32,51,.08)' } } },
  plugins: [],
};
export default config;

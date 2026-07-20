import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#f9fafb",
          raised: "#ffffff",
        },
        border: {
          DEFAULT: "#e5e7eb",
          subtle: "#f1f1f2",
        },
        stage: {
          backlog: "#94a3b8",
          decomposition: "#3b82f6",
          plan: "#8b5cf6",
          develop: "#f59e0b",
          tests: "#06b6d4",
          deploy: "#10b981",
          done: "#22c55e",
          intent: "#facc15",
          "delta-spec": "#14b8a6",
          design: "#a855f7",
          adr: "#ec4899",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        cardHover:
          "0 4px 8px rgba(16, 24, 40, 0.06), 0 2px 4px rgba(16, 24, 40, 0.08)",
      },
    },
  },
  plugins: [],
};
export default config;
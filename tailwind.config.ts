import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--color-ink)",
        muted: "var(--color-muted)",
        canvas: "var(--color-canvas)",
        line: "var(--color-line)",
        lime: "#c5f467",
      },
      boxShadow: {
        card: "0 2px 8px rgba(19, 31, 45, 0.035)",
      },
    },
  },
  plugins: [forms],
} satisfies Config;

import { TextStyle } from "react-native";

export const COLORS = {
  bg: "#0A0C16",
  bg2: "#1A1A2E",
  surface: "#231E39",
  primary: "#FF8C00",
  primaryDark: "#CC7000",
  secondary: "#4A0D15",
  gold: "#FFD700",
  glow: "#FF5722",
  text: "#F5F5F5",
  textDim: "#A0A4B8",
  danger: "#DC143C",
  success: "#4CAF50",
  border: "#3A3B58",
};

export const FONTS: Record<string, TextStyle> = {
  h1: { fontSize: 40, fontWeight: "900", letterSpacing: 3, color: COLORS.gold },
  h2: { fontSize: 28, fontWeight: "800", letterSpacing: 2, color: COLORS.text },
  h3: { fontSize: 20, fontWeight: "700", letterSpacing: 1.5, color: COLORS.text },
  body: { fontSize: 15, color: COLORS.text },
  small: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: COLORS.textDim, fontWeight: "700" },
};

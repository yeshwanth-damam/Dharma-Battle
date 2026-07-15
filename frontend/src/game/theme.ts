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
  h1: { fontSize: 40, fontFamily: "Cinzel-Black", letterSpacing: 3, color: COLORS.gold },
  h2: { fontSize: 28, fontFamily: "Cinzel-Bold", letterSpacing: 2, color: COLORS.text },
  h3: { fontSize: 20, fontFamily: "Cinzel-Bold", letterSpacing: 1.5, color: COLORS.text },
  body: { fontSize: 15, fontFamily: "Exo2-Regular", color: COLORS.text },
  bodyBold: { fontSize: 15, fontFamily: "Exo2-Bold", color: COLORS.text },
  small: { fontSize: 12, fontFamily: "Exo2-Bold", letterSpacing: 1, textTransform: "uppercase", color: COLORS.textDim },
};

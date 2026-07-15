// Loads game fonts (Cinzel + Exo 2) from local assets, alongside icon fonts.
// Icon fonts are still loaded from CDN under Expo Go.
// Usage: const [loaded, error] = useGameFonts();

import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFonts } from "expo-font";

const ICON_VECTOR_VERSION = "15.1.1";

const ICON_FAMILIES: Record<string, string> = {
  anticon: "AntDesign",
  entypo: "Entypo",
  evilicons: "EvilIcons",
  feather: "Feather",
  FontAwesome: "FontAwesome",
  Fontisto: "Fontisto",
  foundation: "Foundation",
  ionicons: "Ionicons",
  "material-community": "MaterialCommunityIcons",
  material: "MaterialIcons",
  octicons: "Octicons",
  "simple-line-icons": "SimpleLineIcons",
  zocial: "Zocial",
  "FontAwesome5Free-Regular": "FontAwesome5_Regular",
  "FontAwesome5Free-Solid": "FontAwesome5_Solid",
  "FontAwesome5Free-Brand": "FontAwesome5_Brands",
  "FontAwesome6Free-Regular": "FontAwesome6_Regular",
  "FontAwesome6Free-Solid": "FontAwesome6_Solid",
  "FontAwesome6Free-Brand": "FontAwesome6_Brands",
};

const cdnUrl = (file: string): string =>
  `https://cdn.jsdelivr.net/npm/@expo/vector-icons@${ICON_VECTOR_VERSION}/build/vendor/react-native-vector-icons/Fonts/${file}.ttf`;

const iconFontMap = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(ICON_FAMILIES).map(([key, file]) => [key, cdnUrl(file)]),
  );

const gameFontMap = () => ({
  "Cinzel-Regular": require("../../assets/fonts/Cinzel-Regular.ttf"),
  "Cinzel-Bold": require("../../assets/fonts/Cinzel-Bold.ttf"),
  "Cinzel-Black": require("../../assets/fonts/Cinzel-Black.ttf"),
  "Exo2-Regular": require("../../assets/fonts/Exo2-Regular.ttf"),
  "Exo2-Bold": require("../../assets/fonts/Exo2-Bold.ttf"),
});

export const useGameFonts = (): readonly [boolean, Error | null] =>
  useFonts({
    ...gameFontMap(),
    ...(Constants.executionEnvironment === ExecutionEnvironment.StoreClient
      ? iconFontMap()
      : {}),
  });

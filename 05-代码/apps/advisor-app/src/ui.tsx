import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@tip/ui-native";

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Tag({ text, tone = "default" }: { text: string; tone?: "default" | "ok" | "warn" | "berry" | "navy" }) {
  const map = {
    default: { bg: colors.navy50, fg: colors.navy },
    ok: { bg: "#E6F4EE", fg: "#177A5B" },
    warn: { bg: "#FBF1E2", fg: "#B45309" },
    berry: { bg: colors.berry50, fg: colors.berry },
    navy: { bg: colors.navy, fg: "#fff" }
  } as const;
  const c = map[tone];
  return (
    <View style={[styles.tag, { backgroundColor: c.bg }]}>
      <Text style={[styles.tagText, { color: c.fg }]}>{text}</Text>
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.section}>{text}</Text>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 16, borderWidth: 1, borderColor: "#E5E9F0", marginBottom: 12 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
  tagText: { fontSize: 12, fontWeight: "600" },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E5E9F0", marginRight: 8 },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: 13, color: "#5E6B7E", fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  section: { fontSize: 17, fontWeight: "800", color: "#1B2433", marginBottom: 10, marginTop: 4 }
});

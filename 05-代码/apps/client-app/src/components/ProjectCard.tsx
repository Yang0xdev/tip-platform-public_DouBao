import { Text, View, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../ui";
import type { ProjectView } from "../api";
import { PROJECT_META, type ProjectMeta } from "../projectMeta";

export function ProjectCard({ p, onOpen }: { p: ProjectView; onOpen: () => void }) {
  const m: ProjectMeta | undefined = PROJECT_META[p.code];
  const g: [string, string] = m?.gradient ?? ["#5E246B", "#002661"];
  const chips = (m?.chips ?? []).slice(0, 3);
  return (
    <Pressable onPress={onOpen} style={{ marginBottom: 14 }}>
      <View style={{ backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: "hidden" }}>
        <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ backgroundColor: "rgba(255,255,255,.18)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: colors.white, fontSize: 11, fontWeight: "700" }}>{m?.kind ?? "身份项目"}</Text>
            </View>
            <Text style={{ color: "rgba(255,255,255,.85)", fontSize: 11, fontWeight: "600" }}>{m?.region} · {m?.country ?? p.code}</Text>
          </View>
          <Text style={{ color: colors.white, fontSize: 17.5, fontWeight: "800", marginTop: 10, letterSpacing: 0.2 }}>
            {m?.country ?? p.title}
          </Text>
          <Text style={{ color: "rgba(255,255,255,.92)", fontSize: 12.5, marginTop: 4, lineHeight: 18 }} numberOfLines={2}>
            {m?.tagline ?? p.body}
          </Text>
        </LinearGradient>
        <View style={{ paddingHorizontal: 16, paddingVertical: 13 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.navy, flex: 1, paddingRight: 10 }}>{m?.anchor ?? "费用分项可查"}</Text>
            <View style={{ backgroundColor: colors.okBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 10.5, color: colors.ok, fontWeight: "700" }}>已核验发布</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {chips.map((c) => (
              <View key={c} style={{ backgroundColor: colors.navy50, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Text style={{ color: colors.navy, fontSize: 11, fontWeight: "600" }}>{c}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.lineSoft }}>
            <Text style={{ fontSize: 10.5, color: colors.faint, flex: 1, paddingRight: 8 }}>{p.code} · 费用分项/收取方/依据文件可查</Text>
            <Text style={{ fontSize: 12.5, fontWeight: "800", color: colors.berry }}>查看费用与初评 ›</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

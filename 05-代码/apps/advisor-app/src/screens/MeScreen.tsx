import React from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Card, SectionLabel, Tag } from "../ui";

const COMMITMENTS = [
  "不引导平台外收款，不私下收取任何费用",
  "不在平台外作出结果承诺或夸大表述",
  "不协助虚假材料，发现即停止服务并上报",
  "对客户信息保密，跨境共享须单独同意"
];

export default function MeScreen() {
  return (
    <ScrollView style={{ backgroundColor: "#F5F7FA" }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <LinearGradient
        colors={["#AF2D67", "#5E246B", "#002661"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 20, padding: 20, marginBottom: 16 }}
      >
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800" }}>陈某</Text>
        <Text style={{ color: "#fff", opacity: 0.9, marginTop: 6 }}>资深顾问 · 备案号 BJ-2026-018</Text>
        <Text style={{ color: "#fff", opacity: 0.9, marginTop: 2 }}>示例出入境咨询（北京）有限公司</Text>
        <View style={{ flexDirection: "row", marginTop: 12 }}>
          <View style={{ backgroundColor: "rgba(255,255,255,.18)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>已授权：PROJ-TECH-A</Text>
          </View>
        </View>
      </LinearGradient>

      <Card>
        <SectionLabel text="展业承诺" />
        {COMMITMENTS.map((c, i) => (
          <Text key={i} style={{ color: "#5E6B7E", fontSize: 14, lineHeight: 22 }}>· {c}</Text>
        ))}
      </Card>

      <Card>
        <SectionLabel text="iPad 展业模式" />
        <Text style={{ color: "#5E6B7E", fontSize: 14, lineHeight: 21 }}>
          面向客户的需求采集与方案共读模式，含“不承诺事项”逐项知悉；演示模式与工作模式分离。
        </Text>
        <Text
          onPress={() => Alert.alert("iPad 展业模式", "请在 iPad 安装“顾问展业”并登录，自动启用大屏双模式。")}
          style={{ marginTop: 10, color: "#0B3A82", fontWeight: "700", fontSize: 14 }}
        >
          了解如何启用 ›
        </Text>
      </Card>

      <Card>
        <SectionLabel text="合规与帮助" />
        <Text
          onPress={() => Linking.openURL("https://www.gapp.gov.cn/")}
          style={{ color: "#0B3A82", fontSize: 14, marginBottom: 8 }}
        >
          国家移民管理局公开信息
        </Text>
        <Text style={{ color: "#8A95A6", fontSize: 12 }}>
          遇到合规疑问可随时转平台合规台，不自行解释政策。
        </Text>
      </Card>
    </ScrollView>
  );
}

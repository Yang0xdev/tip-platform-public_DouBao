import React from "react";
import { Text } from "react-native";
import { NavigationContainer, type NavigatorScreenParams } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { colors } from "@tip/ui-native";

import HomeScreen from "./screens/HomeScreen";
import ProjectListScreen from "./screens/ProjectListScreen";
import ProjectDetailScreen from "./screens/ProjectDetailScreen";
import AssessmentScreen from "./screens/AssessmentScreen";
import GlobalAccessScreen from "./screens/GlobalAccessScreen";
import FavoritesScreen from "./screens/FavoritesScreen";
import ProfileScreen from "./screens/ProfileScreen";

export type TabParamList = {
  HomeTab: undefined;
  ProjectsTab: undefined;
  GlobalTab: undefined;
  MeTab: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Projects: undefined;
  ProjectDetail: { id: string; title: string };
  Assessment: { projectCode: string };
  Favorites: undefined;
  GlobalAccess: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const headerBase = {
  headerStyle: { backgroundColor: colors.white },
  headerTitleStyle: { color: colors.ink, fontWeight: "700" as const, fontSize: 16 },
  headerTintColor: colors.navy,
  headerShadowVisible: false
};

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: 17 }}>{glyph}</Text>;
}

/** M1 仅 4 个 tab：办理中/服务等随 M3/M4 里程碑加入，不放假入口。 */
function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        ...headerBase,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: { borderTopColor: colors.line, height: 60, paddingBottom: 6 }
      }}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: "首页", headerShown: false, tabBarIcon: ({ color }) => <TabIcon glyph="⌂" color={color} /> }} />
      <Tab.Screen name="ProjectsTab" component={ProjectListScreen} options={{ title: "项目", tabBarIcon: ({ color }) => <TabIcon glyph="▤" color={color} /> }} />
      <Tab.Screen name="GlobalTab" component={GlobalAccessScreen} options={{ title: "全球通行", tabBarIcon: ({ color }) => <TabIcon glyph="◎" color={color} /> }} />
      <Tab.Screen name="MeTab" component={ProfileScreen} options={{ title: "我的", tabBarIcon: ({ color }) => <TabIcon glyph="◔" color={color} /> }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={headerBase}>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Projects" component={ProjectListScreen} options={{ title: "身份项目" }} />
        <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} options={{ title: "项目详情" }} />
        <Stack.Screen name="Assessment" component={AssessmentScreen} options={{ title: "初步评估" }} />
        <Stack.Screen name="GlobalAccess" component={GlobalAccessScreen} options={{ title: "全球通行" }} />
        <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ title: "本机收藏与对比" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

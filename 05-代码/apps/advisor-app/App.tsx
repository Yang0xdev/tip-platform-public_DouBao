import "react-native-gesture-handler";
import React from "react";
import { Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, type RouteProp } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import QueueScreen from "./src/screens/QueueScreen";
import ClientsScreen from "./src/screens/ClientsScreen";
import ClientDetailScreen from "./src/screens/ClientDetailScreen";
import ProposalScreen from "./src/screens/ProposalScreen";
import CasesScreen from "./src/screens/CasesScreen";
import MeScreen from "./src/screens/MeScreen";
import AdvisorAiScreen from "./src/screens/AdvisorAiScreen";
import LearningScreen from "./src/screens/LearningScreen";
import { colors, RaisedTabBar } from "@tip/ui-native";

export type RootStackParamList = {
  ClientsList: undefined;
  ClientDetail: { relationshipId: string; customerRef: string };
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

function tabIcon(glyph: string) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Text style={{ color, fontSize: 18, fontWeight: focused ? "800" : "600" }}>{glyph}</Text>
  );
}

function ClientsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: "#F5F7FA" } }}>
      <Stack.Screen name="ClientsList" component={ClientsScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ClientDetail"
        component={ClientDetailScreen}
        options={({ route }: { route: RouteProp<RootStackParamList, "ClientDetail"> }) => ({
          title: `客户 ${route.params.customerRef}`,
          headerBackTitle: "返回"
        })}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <Tab.Navigator
            tabBar={(props) => <RaisedTabBar {...props} centerName="AI" />}
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: "#F5F7FA" },
              tabBarActiveTintColor: colors.navy,
              tabBarInactiveTintColor: "#8A95A6",
              tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
              tabBarStyle: { backgroundColor: "#fff", borderTopColor: "#E5E9F0" }
            }}
          >
            <Tab.Screen name="工作台" component={QueueScreen} options={{ tabBarIcon: tabIcon("◔") }} />
            <Tab.Screen name="客户" component={ClientsStack} options={{ tabBarIcon: tabIcon("◍") }} />
            <Tab.Screen name="案件" component={CasesScreen} options={{ tabBarIcon: tabIcon("◷") }} />
            <Tab.Screen name="AI" component={AdvisorAiScreen}
              options={{ tabBarIcon: tabIcon("✦"), tabBarActiveTintColor: colors.berry }} />
            <Tab.Screen name="方案" component={ProposalScreen} options={{ tabBarIcon: tabIcon("≡") }} />
            <Tab.Screen name="学习" component={LearningScreen} options={{ tabBarIcon: tabIcon("◇") }} />
            <Tab.Screen name="我的" component={MeScreen} options={{ tabBarIcon: tabIcon("◌") }} />
          </Tab.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

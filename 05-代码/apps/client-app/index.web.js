import { registerRootComponent } from "expo";
import App from "./App";

/**
 * Web 演示 App 外壳（仅 web）：
 * 桌面浏览器中把应用约束为居中的手机宽度 App 画框；移动端全屏。
 */
const FRAME_STYLE = `
html, body { background: #E9EDF3; }
#root {
  width: 100%;
  max-width: 430px;
  margin: 0 auto;
  position: relative;
  box-shadow: 0 24px 70px rgba(10, 26, 61, 0.20), 0 2px 10px rgba(10, 26, 61, 0.08);
  background: #F5F7FA;
  min-height: 100%;
}
@media (max-width: 480px) {
  html, body { background: #F5F7FA; }
  #root {
    max-width: 100%;
    box-shadow: none;
  }
}
`;

const styleEl = document.createElement("style");
styleEl.setAttribute("id", "app-demo-frame");
styleEl.appendChild(document.createTextNode(FRAME_STYLE));
document.head.appendChild(styleEl);

registerRootComponent(App);

import { Platform } from "react-native";

export interface PickedFile {
  name: string;
  mime: string;
  sizeBytes: number;
  /** SHA-256（hex），服务端去重与凭证 */
  hash: string;
}

/**
 * 选择文件并计算哈希。
 * Web（演示/实时网页）：隐藏 <input type="file"> + crypto.subtle SHA-256。
 * 原生端：接入文档选择器（开发项），当前给出明确提示，不伪装成功。
 */
export function pickFile(accept: string[]): Promise<PickedFile> {
  if (Platform.OS !== "web") {
    return Promise.reject(new Error("原生端文件选择器将在后续版本接入；当前演示请使用网页。"));
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.style.display = "none";

    let settled = false;
    const cleanup = () => {
      input.remove();
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error("未选择文件"));
        }
        return;
      }
      file
        .arrayBuffer()
        .then(async (buf) => {
          const digest = await crypto.subtle.digest("SHA-256", buf);
          const hash = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          if (!settled) {
            settled = true;
            cleanup();
            resolve({ name: file.name, mime: file.type || "application/octet-stream", sizeBytes: file.size, hash });
          }
        })
        .catch((e: Error) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(e);
          }
        });
    };

    document.body.appendChild(input);
    input.click();
  });
}

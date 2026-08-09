import type { NextConfig } from "next";
import os from "os";

// 自动列出当前所有局域网 IP（每次连不同 WiFi/热点会变，启动时重新检测即可，无需手动改）。
// 手机用局域网 IP 访问开发服务器时，Next.js 默认会把它当作"跨域"拦截掉开发资源
// （热重载连接等），导致页面按钮等交互失效——把这些 IP 加入白名单即可解决。
function getLanIPs(): string[] {
  const ips: string[] = ["localhost", "127.0.0.1"];
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/teacher/:id",
        destination: "/listing/:id",
        permanent: true,
      },
    ];
  },
  experimental: {
    serverActions: {
      // 允许上传较大的图片（默认只有 1MB，这里放宽到 15MB）
      bodySizeLimit: "15mb",
    },
  },
  allowedDevOrigins: getLanIPs(),
};

export default nextConfig;

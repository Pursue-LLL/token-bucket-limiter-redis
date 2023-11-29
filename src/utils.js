
export function getClientIp(req) {
  // 获取 X-Real-IP 头部字段
  const xRealIP = req.headers['x-real-ip'];

  // 优先使用 X-Real-IP 头部字段
  if (xRealIP) {
    return xRealIP;
  }

  // 获取 X-Forwarded-For 头部字段，通常包含一个或多个IP地址，最左侧的是最初的客户端IP
  const xForwardedFor = req.headers['x-forwarded-for'];

  // 如果 X-Real-IP 不存在，但 X-Forwarded-For 存在，则使用最左侧的IP地址
  if (xForwardedFor) {
    const ipList = xForwardedFor.split(',');
    return ipList[0].trim();
  }

  // 获取连接的远程IP地址
  const remoteAddress = req.socket?.remoteAddress || req.connection?.remoteAddress;
  // 如果都不存在，使用连接的远程IP地址
  if (remoteAddress) {
    return remoteAddress;
  }

  return '';
}

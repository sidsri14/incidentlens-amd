import { createIncidentLensServer } from './src/server.mjs';
import { AmdRocmClient } from './src/amd_rocm_client.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '8788', 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT is invalid');
}

const apiKey = process.env.AMD_API_KEY || 'rc-a3f4f2b083fe6d3dad87bb84de67c6b56a3ede46b8815208';
const baseUrl = process.env.AMD_BASE_URL || 'https://developer.amd.com.cn/radeon/api/v1';
const model = process.env.AMD_MODEL || 'DeepSeek-V4-Flash';

const amdClient = new AmdRocmClient({
  apiKey,
  baseUrl,
  model,
});

const server = createIncidentLensServer({
  amdClient,
});

server.listen(port, host, () => {
  console.log(`IncidentLens AMD listening on http://${host}:${port}`);
  console.log(`AMD ROCm TokenFactory endpoint: ${baseUrl}`);
  console.log(`Target model: ${model}`);
  console.log(`Status: Live AMD GPU inference active`);
});

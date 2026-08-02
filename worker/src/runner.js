import { Container } from '@cloudflare/containers';

// 作业容器。只在有作业时被唤醒，空转十分钟后自行休眠（按活跃时长计费）。
export class PipelineRunner extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';

  constructor(ctx, env) {
    super(ctx, env);
    // 容器内没有任何绑定，读写对象存储要回打本 Worker 的 /store，故把地址与令牌注进去
    this.envVars = {
      WORKER_URL: env.WORKER_URL || '',
      INGEST_TOKEN: env.INGEST_TOKEN || '',
      GH_TOKEN: env.GH_TOKEN || '',
      GH_REPO: env.GH_REPO || '',
      LYRIC_MAKER: env.LYRIC_MAKER || '',
      LLM_API_KEY: env.LLM_API_KEY || '',
      LLM_API_BASE: env.LLM_API_BASE || '',
      LLM_MODEL: env.LLM_MODEL || '',
      OCR_MODEL: env.OCR_MODEL || '',
    };
  }
}

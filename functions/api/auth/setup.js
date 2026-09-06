import { json, directory } from './_lib.js';

export async function onRequestGet({ env }) {
  return json({
    needsBootstrap: env.USERS ? await directory(env).isEmpty() : false,
    githubConfigured: !!(env.GITHUB_OAUTH_CLIENT_ID && env.GITHUB_OAUTH_CLIENT_SECRET),
  });
}

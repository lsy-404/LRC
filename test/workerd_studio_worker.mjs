import { handleApi } from '../worker/src/api.js';
export { UserDirectory } from '../worker/src/users.js';

export default {
  fetch: (request, env) => handleApi(request, env),
};

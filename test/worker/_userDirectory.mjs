// 用真实的 node:sqlite 承载 worker/src/users.js 的 ctx.storage.sql 调用：
// 拿到和生产环境同一套 SQL 语句的真实执行结果，而不是重新手写一份内存实现。
// 加载手法与 test/worker/orchestrator_job.test.mjs 里的 loadJob() 一致。

import fs from 'node:fs/promises';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

class FakeDurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

// Cloudflare 的 sql.exec() 是同步 API，返回的游标支持 toArray()/one()/迭代；
// node:sqlite 的 StatementSync#all() 对 SELECT、INSERT/UPDATE/DELETE ... RETURNING
// 以及普通写操作都会真正执行语句，语义上已经够贴近真实环境。
function sqlStorage(db) {
  return {
    exec(query, ...bindings) {
      const rows = db.prepare(query).all(...bindings);
      return {
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error('expected exactly one row');
          return rows[0];
        },
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      };
    },
  };
}

async function loadUserDirectoryClass() {
  const source = await fs.readFile(new URL('../../worker/src/users.js', import.meta.url), 'utf8');
  const workers = new vm.SyntheticModule(['DurableObject'], function () {
    this.setExport('DurableObject', FakeDurableObject);
  });
  const module = new vm.SourceTextModule(source, { identifier: 'users.js' });
  await module.link((specifier) => {
    if (specifier === 'cloudflare:workers') return workers;
    throw new Error(`unexpected import: ${specifier}`);
  });
  await module.evaluate();
  return module.namespace.UserDirectory;
}

// 每次调用都是一个全新的、独立内存数据库的 DO 实例——对应一次全新部署
export async function createDirectory() {
  const UserDirectory = await loadUserDirectoryClass();
  const db = new DatabaseSync(':memory:');
  return new UserDirectory({ storage: { sql: sqlStorage(db) } }, {});
}

// env.USERS.getByName() 在测试里忽略实例名，始终返回同一个单例目录，和生产的
// getByName('directory') 用法保持一致
export function usersBinding(dir) {
  return { getByName: () => dir };
}

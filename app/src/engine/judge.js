import { resultRows, cmpRows } from '../domain/grading.js';

export function createJudge(runtime, seed) {
  function query(sql) {
    const database = new runtime.Database(seed);
    try {
      database.exec('PRAGMA query_only=ON');
      const statements = database.iterateStatements(sql);
      const first = statements.next();
      if (first.done) throw new Error('请写一条 SELECT 或 WITH 查询');
      const statement = first.value.getSQL().replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
      if (!/^(SELECT|WITH|VALUES)\b/i.test(statement)) throw new Error('判题只接受查询；修改表请使用自由练习区');
      if (!statements.next().done) throw new Error('判题一次只接受一条查询，请移除额外语句');
      return resultRows(database.exec(sql));
    } finally {
      database.close();
    }
  }

  return {
    query,
    grade(question, sql) {
      const mine = query(sql);
      const ref = query(question.answer);
      return { mine, ref, passed: cmpRows(mine, ref, question.orderCols) };
    },
  };
}

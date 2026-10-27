import { buildEnrichmentDatabase, TRAINING_CASES } from '../content/enrichment-data.js';
import { createJudge } from './judge.js';
import { cmpRows } from '../domain/grading.js';

export function createEnrichmentJudge(runtime) {
  const judges = TRAINING_CASES.map(item => {
    const database = buildEnrichmentDatabase(runtime, item.id);
    try { return { ...item, judge: createJudge(runtime, database.export()) }; }
    finally { database.close(); }
  });
  return {
    query(sql, caseID = 'standard') { return judges.find(item => item.id === caseID).judge.query(sql); },
    grade(question, sql) {
      const references = judges.map(item => {
        try { return item.judge.query(question.answer); }
        catch { throw Object.assign(new Error('参考样本暂时无法验证，请稍后重试。'), { systemFailure: true }); }
      });
      const cases = judges.map((item, index) => {
        const mine = item.judge.query(sql), ref = references[index];
        return { id: item.id, name: item.name, mine, ref, passed: cmpRows(mine, ref, question.orderCols) };
      });
      return { ...cases[0], passed: cases.every(item => item.passed), cases };
    },
  };
}

import { createFeedbackStorage } from './feedback-storage.mjs';
import { createEditorialStorage } from './editorial-storage.mjs';
import { createEarlyReaderStorage } from './early-reader-storage.mjs';
import { insertReply, insertSubscription } from './submissions.mjs';

export function createD1Storage(database) {
  const all = async (sql, ...values) => {
    const query = await database.prepare(sql).bind(...values).all();
    return query.results ?? [];
  };
  const run = (sql, ...values) => database.prepare(sql).bind(...values).run();
  return {
    ...createFeedbackStorage(all, run),
    ...createEditorialStorage(all, run),
    ...createEarlyReaderStorage(all, run),
    newsletter: (...values) => run(insertSubscription, ...values),
    reply: (...values) => run(insertReply, ...values),
  };
}

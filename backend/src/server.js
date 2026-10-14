import { assertConfig, config } from './config.js';
import { closeDb, initDb } from './db.js';
import { createApp } from './app.js';
import { bootstrapStaff } from './routes/staff.js';
import { startSweeper } from './services/sweeper.js';

assertConfig();
const database = await initDb(); // open + migrate before accepting traffic
await bootstrapStaff();

const server = createApp().listen(config.port, () => {
  console.log(
    `smeter API on :${config.port} (env=${config.appEnv}, db=${database.kind}, geni=${config.geni.mode}, payments=${config.payments.provider}, email=${config.email.provider})`,
  );
});
const stopSweeper = startSweeper();

function shutdown() {
  stopSweeper();
  server.close(() => closeDb().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
